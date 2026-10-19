# Build in 3D — Tidy Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated lines put every pipe and cable on a fixed straight run (the approved cross-section) instead of path-searching each network, with transformers in the power run next to the machines they feed.

**Architecture:** A new tidy layout (`src/layout/tidy*.ts`) assigns slice machines to four rows, gives each row fixed output/input runs, a sandwiched power run and a power feed behind it, and joins runs only inside a per-slice service column using the existing router with step limits and a bend penalty. The core reuses the existing region router (`routeRegion`) with the through-runs as its lanes. The current compact/narrow/roomy forms become the fallback.

**Tech Stack:** TypeScript, Vitest, Playwright (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-19-build-in-3d-design.md`, section "Tidy routing (2026-10-19, decided by the user)".

## Global Constraints

- Cross-section per side s (north s = −1, south s = +1): lower machine (x, 0, s), upper machine (x, 2, s); output runs (x, 0, 2s) and (x, 2, 2s); input runs (x, −1, s) and (x, 3, s); power run (x, 1, s); power feed (x, 1, 2s).
- Walkway (z = 0, y = 0..1) and the floor under it (y = −1, z = 0) stay empty. Bounds for any routing: z ∈ [−3, 3], y ∈ [−1, 3].
- Fronts face the walkway (`mainFacing` 3 on the north side, 2 on the south); output face is the back (`facing` 2 north, 3 south). DIRS order: 0 down, 1 up, 2 north (−z), 3 south (+z), 4 west (−x), 5 east (+x).
- Outside service columns and the core, conduits connect only along x (to the same run) or to the block they serve.
- Transformers step down one tier, input face (`facing`) toward the power feed; one per 4 A of the lower voltage, per side, per slice (per stretch for straight lines).
- Fallback note (exact): "Couldn't keep this line tidy, so some pipes take detours". Floor note (exact): "The floor pipes sit one block below the walkway: dig one layer for them".
- The checker (`checkLine`) has the last word: a tidy layout that doesn't pass it is not used.

## Review Focus

1. A slice with more machine kinds than rows (5+ kinds) → split stretches and through-runs, or a clean fallback with the note — never an unconnected machine. (Task 3 + Task 5 tests.)
2. Two machines of different voltages forced onto one side → row assignment refuses it; generators don't count as consumers. (Task 3 test.)
3. HV source with LV machines → HV→MV in the core, MV feed, MV→LV in the power runs; checker passes. (Task 6 test.)
4. Growing a tidy line by a slice and exporting one slice → still identical slices that join (through-runs open along x at slice edges). (Task 5 test.)
5. A machine with a second input or output (core reactor/electrolyzer) → served by the core router with covers/filters as before; the tidy invariant is only asserted outside the core. (Task 5 test.)

---

### Task 1: Move the shared region router out of build.ts

**Files:**
- Create: `src/layout/region.ts`
- Modify: `src/layout/build.ts`

**Interfaces:**
- Produces (exported from `region.ts`): types `Unit`, `Placed`, `Net`, `Region`, `Routed`, `ConduitKind`; constants `TIERS`, `SIDE_NAME`; functions `tierOf`, `sideTo`, `planNets`, `transformersFor`, `countTransformers`, `machineUnits`, `markerUnits`, `routeRegion`, `conduitBlocks`, `unitBlock`, `withFront`, `powerNets`, `lineNetworks`, `assemble`, `placeCore` — same signatures as today.

- [ ] **Step 1:** Move those declarations verbatim into `region.ts`, export them, import them in `build.ts`. No behaviour change.
- [ ] **Step 2:** Run `npx vitest run` and `npx tsc -b`. Expected: 378/378 pass, no type errors.
- [ ] **Step 3:** Commit `refactor: shared region router in its own module`.

### Task 2: Router step limits and bend penalty

**Files:**
- Modify: `src/model/route.ts`
- Test: `src/model/route.test.ts`

**Interfaces:**
- Produces: `RouteRequest.canStep?: (from: Vec3, to: Vec3) => boolean` (a move is allowed only when it returns true) and `RouteRequest.bendPenalty?: number` (extra cost when a path changes direction; default 0, so existing callers are unchanged).

- [ ] **Step 1: Failing tests**
  - `canStep limits moves`: terminals [[0,0,0]] and [[4,0,2]], bounds 0..4 × 0..0 × 0..2, `canStep` allowing z-moves only at x = 4 → every cell with z ≠ 0 has x = 4.
  - `bendPenalty prefers one bend`: open 5×1×5 grid from [0,0,0] to [4,0,4] with `bendPenalty: 3` → path has exactly one direction change (count bends along the returned cells ordered from terminal 0).
- [ ] **Step 2:** Run `npx vitest run src/model/route.test.ts`. Expected: both FAIL.
- [ ] **Step 3:** Implement: Dial's search over states (cell, arrival direction) when `bendPenalty > 0`; `canStep` filters neighbour moves. Tree cells stay free to re-enter (cost 0) as today.
- [ ] **Step 4:** Run the route tests, then `npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: router step limits and bend penalty`.

### Task 3: Rows — which machines go where

**Files:**
- Create: `src/layout/tidyRows.ts`
- Test: `src/layout/tidyRows.test.ts`

**Interfaces:**
- Consumes: `PlanMachine` (types.ts), `tierOf` (region.ts).
- Produces:
  ```ts
  export type RowId = 0 | 1 | 2 | 3; // 0 north lower, 1 north upper, 2 south lower, 3 south upper
  export const ROWS: readonly { side: -1 | 1; y: 0 | 2 }[];
  export interface Stretch { row: RowId; x0: number; count: number; machine: PlanMachine }
  export interface Arrangement { columns: number; stretches: Stretch[] }
  /** Candidate arrangements, best first: fewest columns, then fewest stretches, then fewest rows shared by two kinds. */
  export function arrangeRows(machines: PlanMachine[], maxColumns?: number): Arrangement[];
  ```
- Rules: machines of one kind fill a row left to right and spill into the next row; a row's free cells may take the next kind as a new stretch; both rows of a side carry consumers of one tier only (generators and multiblocks exempt); at most 12 candidates returned.

- [ ] **Step 1: Failing tests**
  - Oil slice (1 LV extractor, 3 LV distilleries, 1 MV generator) → first arrangement has `columns` 2 and every stretch's machine on a side has one consumer tier.
  - LV + MV consumers (2 LV assemblers, 2 MV electrolyzers) → no arrangement puts an LV and an MV consumer on the same side.
  - Six kinds of one machine each → `columns` 2, and some row holds two stretches.
- [ ] **Step 2:** Run `npx vitest run src/layout/tidyRows.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement by trying kind orders (all permutations up to 6 kinds, else the plan order) for columns = ceil(total/4) up to `maxColumns` (default ceil(total/4)+2), packing first-fit, filtering by the tier rule, de-duplicating, sorting by the stated score.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: arrange slice machines into tidy rows`.

### Task 4: A tidy slice

**Files:**
- Create: `src/layout/tidySlice.ts`
- Test: `src/layout/tidySlice.test.ts`

**Interfaces:**
- Consumes: `Arrangement`, `ROWS` (Task 3); `Net`, `Placed`, `Routed`, `routeNetwork` with `canStep`/`bendPenalty` (Tasks 1–2); `cableFor`, `VOLTAGE` (power.ts).
- Produces:
  ```ts
  export interface TidySlice {
    length: number;                   // columns + 1 (service column at x = columns)
    units: Placed[];                  // machines and transformers, with facing / mainFacing
    routed: Routed;                   // conduit cells, attach, ends, covers, notes (slice-relative)
    throughRuns: Map<string, Vec3[]>; // net id -> its straight run across x = 0..length-1 (lanes for the core)
  }
  export function tidySlice(arr: Arrangement, nets: Net[], plan: LinePlan): TidySlice | { fail: string };
  ```
- Behaviour:
  - Machines at their row cells; front toward the walkway, output on the back.
  - Each stretch's output run = its primary output network (item first, as today; generators: the source power network); input run = its primary input network.
  - Power run per side at that side's consumer tier; transformers placed in the power run (service column first, then machine columns), input face toward the feed, count = ceil(side demand ÷ (V × 4)).
  - Feed on both sides at the source tier when anything on the side needs it.
  - A network needed outside the slice (by the core, markers, or other slices) gets a through-run: its own run extended over free cells of the same slot across the whole slice when possible, else a spare slot (y = −1 or 3 at z = ±2, or z = ±3) for the whole length.
  - Runs of one network joined in the service column only (`canStep`: off-x moves only at x = columns; bounds per Global Constraints; `bendPenalty` 2). Second inputs/outputs use a free face at a stretch end or the service column, with pump/conveyor covers and Item Filters as in `routeRegion`.
  - Conduits connect along x to their own run, and to the blocks they serve; through-runs stay open on −x/+x at x = 0 and x = length − 1.

- [ ] **Step 1: Failing tests** (oil plan from `reference()`, arrangement from Task 3):
  - `oil slice is tidy`: outside x = columns, every conduit's forcedOn sides are only 4/5 or face a non-conduit block.
  - `every slice machine touches its input run, its output run and power`: for each extractor/distillery the cell below/above holds its input network, the back cell its output network, and a power-run cable or transformer touches it.
  - `the slice fits the cross-section`: all cells within z ∈ [−3, 3], y ∈ [−1, 3]; walkway cells empty.
  - `oil, berries, light fuel, sulfuric light fuel and MV feed run through the slice`: `throughRuns` has those nets, each spanning x = 0..length−1 in one straight slot.
- [ ] **Step 2:** Run `npx vitest run src/layout/tidySlice.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `tidySlice`.
- [ ] **Step 4:** Run the tests, then `npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: tidy slice with fixed runs`.

### Task 5: Tidy modular lines

**Files:**
- Create: `src/layout/tidy.ts`
- Modify: `src/layout/build.ts` (buildOnce order), `src/layout/build.test.ts`
- Test: `src/layout/tidy.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `export function buildTidy(plan: LinePlan, name: string, warnings: string[]): Build | undefined` — modular plans: slices from `tidySlice`, core placed with `placeCore` at lower-row cells and routed with `routeRegion` using the through-runs as lanes (core bounds per Global Constraints), `generated` metadata as today. Returns undefined when nothing passes the checker.
- `buildOnce`: modular → `buildTidy` first; then the old forms with the fallback note; straight as before (Task 6 changes it).
- Notes: floor note when any floor run exists.

- [ ] **Step 1: Failing tests**
  - `the oil line is tidy`: passes `checkLine`; outside service columns and the core, conduits connect only along x or to the block they serve; z span ≤ 7, y span ≤ 5; notes include the floor note and no "fall short".
  - `a tidy line grows and exports one slice`: `addSlice` then `checkLine` passes; `sliceBuild` blocks equal the template.
  - `a line that can't be tidy says so`: a plan the tidy layout rejects (6 kinds plus 2 extra inputs per machine, or force `tidySlice` to fail via a 0-column limit) → notes include the fallback note and `checkLine` passes.
- [ ] **Step 2:** Run `npx vitest run src/layout/tidy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `buildTidy` (modular) and the new `buildOnce` order; update older build tests that assert the old form's shape (keep their checker/BOM assertions).
- [ ] **Step 4:** Run `npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: tidy modular lines`.

### Task 6: Tidy straight lines and HV

**Files:**
- Modify: `src/layout/tidy.ts`, `src/layout/build.ts`
- Test: `src/layout/tidy.test.ts`, `src/layout/loss.test.ts`

**Interfaces:**
- Produces: `buildTidy` handles `style: 'straight'` as one stretch-per-kind slice (no `generated`), service column at the end, core at the other end. `buildOnce` tries it first for straight plans and for the modular → straight fallback.

- [ ] **Step 1: Failing tests**
  - `straight oil line loses under 15%`: `cableLoss(build, plan).total < 0.15 × total demand`; no "fall short"; `checkLine` passes.
  - `transformers sit next to what they feed`: every transformer touches a machine of its lower tier or the power run next to one.
  - `HV power lays out`: the reference chain with outside power at HV (as in the reviewer's variant: no generator node, outside source HV) → `checkLine` passes; an HV→MV transformer exists; MV→LV transformers sit in power runs.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: tidy straight lines and HV feeds`.

### Task 7: End to end, screenshots, schematics

**Files:**
- Modify: `e2e/calculator.spec.ts` (only where it asserts the old shape)

- [ ] **Step 1:** Run `npx playwright test`. Fix only assertions about the old layout's shape; behaviour assertions stay.
- [ ] **Step 2:** `npm run build`. Expected: success.
- [ ] **Step 3:** Commit `test: e2e for tidy lines`.
- [ ] **Step 4:** With a temporary spec (deleted afterwards), screenshot the oil line (labels on) and export the full and one-slice schematics plus notes and materials to the session scratchpad. Look at the screenshot: straight parallel runs, crossovers only in service columns.
