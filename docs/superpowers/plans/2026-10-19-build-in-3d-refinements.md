# Build in 3D — Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact generated layouts, account for GregTech cable loss with the full range of cable sizes, and show what every pipe and cable carries (floating icons, hover highlight, clickable legend).

**Architecture:** Cable data grows (all sizes, loss per block); `cableFor` picks by tier → amps → loss; a new `cableLoss` walks each cable network from its sources and the layout adds generators when losses eat the margin. Layout tries a compact cross-section first (lanes touching the machines, a shared service column per two machine columns) and falls back to today's spacing. Every generated conduit records its network (`PlacedBlock.net`) and the build lists its networks (`Build.networks`), which the editor uses for icons, highlight and legend.

**Tech Stack:** as before (React 19, three/r3f/drei, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-19-build-in-3d-design.md` — section "Refinements after the first preview" (decided by the user).

## Global Constraints

- Cable loss per block per amp, from GT 5.09.54.183 LoaderMetaPipeEntities: Tin 1 (LV, 1 A/1x), Copper 2 (MV, 1 A), Annealed Copper 1 (MV, 1 A), Gold 2 (HV, 3 A), Electrum 1 (HV, 2 A, start 1440), Silver 1 (HV, 1 A, start 1460). Cable sizes 1x/2x/4x/8x/12x/16x = start + 6/7/8/9/10/11; amps = base × size; loss doesn't change with size.
- `cableFor(tier, amps)`: tier ≥ network tier, one cable carrying `amps`, then lowest loss, then smallest size, then lowest tier.
- Every generated layout still passes `checkLine` (no exceptions); slices stay identical.
- "Show what's in pipes" toggle text exactly; legend heading **What the pipes carry**.

## Review Focus

1. A compact slice that can't route → falls back to the roomy cross-section, never an unconnected machine. (Task 3 test.)
2. Generators already at their margin + cable loss → an extra generator per slice (or a plain warning), never a silent shortfall. (Task 2 test.)
3. Old saved builds without `net`/`networks` → load and render without labels or highlight errors. (Task 4 test.)
4. Hovering a hand-placed pipe (no network info) → info panel shows the pipe only, no crash. (Task 5 e2e.)
5. Many labels (big line) → icons only on lanes once per slice, so the 3D view stays responsive. (Task 5 test on label count.)

---

### Task 1: All cable sizes, electrum/silver, loss data, better cable choice

**Files:** `src/catalog/entries.ts`, `src/catalog/types.ts`, `src/catalog/catalog.test.ts`, `src/layout/power.ts`, `src/layout/build.test.ts`, `scripts/extract-textures.ts` (only if new textures are needed).

- [ ] **Step 1: Failing tests:** `'every cable size exists with GT ids'` → `copper_cable_8x` mID 1369, `annealed_copper_cable_16x` mID 1391, `electrum_cable_2x` mID 1447 with `cable: { tier: 'HV', ampsPerSize: 2, size: 2, lossPerBlock: 1 }`; `'cableFor prefers low loss'` → `cableFor('MV', 6).key === 'annealed_copper_cable_8x'`, `cableFor('HV', 4).key === 'electrum_cable_2x'`, `cableFor('LV', 3).key === 'tin_cable_4x'`, `cableFor('HV', 100).warning` matches `/more than/`. Update the Task-4 expectation `cableFor('MV', 6)` accordingly.
- [ ] **Step 2–4:** RED → implement (`cable.lossPerBlock`; thickness per size 1x 0.25, 2x 0.3125, 4x 0.4375, 8x 0.5625, 12x 0.6875, 16x 0.8125) → `npx vitest run && npm run typecheck` green.
- [ ] **Step 5: Commit** `feat: every cable size, electrum and silver, low-loss cable choice`

### Task 2: Cable loss in the power budget

**Files:** create `src/layout/loss.ts` + test; modify `src/layout/build.ts`, `src/layout/types.ts`.

**Produces:** `cableLoss(build: Build, plan: LinePlan): { total: number; perMachine: Map<posKey, number> }` — for each cable component, BFS distance (cable blocks) from every source face (generator output, transformer low side, power marker); each machine draws `ceil(eut / V[tier])` amps over its shortest distance × the cable's `lossPerBlock`; transformers' high side counts as a consumer of the higher network.

- [ ] **Step 1: Failing tests:** `'a 10-block LV tin run to a 30 EU/t machine loses 10 EU/t'` (hand-made build); `'the oil line reports its cable loss in the notes'` → note matching `/Cables lose about \d+ EU\/t/`; `'a slice whose generators can't cover machines plus loss gets another generator'` (fixture: per-slice demand + loss > gens × output → `build.blocks` has one more generator per slice than the plan, checker passes).
- [ ] **Step 2–4:** RED → implement (after routing a slice/core, compute loss; if generator output < demand + loss, add a generator unit and re-route that region) → green.
- [ ] **Step 5: Commit** `feat: count cable loss and add generators to cover it`

### Task 3: Compact cross-section

**Files:** `src/layout/build.ts`, `src/layout/build.test.ts`.

- Compact slice: machine columns in pairs with one shared service column between pairs (`M M S` repeating, x = 0,1 machines, 2 service, …); lane slots in order `(−1, ±1)` under bottom machines, `(2, ±1)` over top machines, `(0, ±2)`, `(1, ±2)`, then `(−1, ±2)`, `(2, ±2)`, `(0, ±3)`, `(1, ±3)`; bounds z ±3. Core: machines one high in adjacent columns, markers at z ±3. Roomy (today's) cross-section stays as the fallback after the compact tries.
- [ ] **Step 1: Failing tests:** `'the oil line is compact'` → modular oil line bounding box width (z) ≤ 7 and volume ≤ 0.6 × 1584 (today's 36×4×11), checker `[]`; `'a slice too busy for the compact form falls back to the roomy one'` (fixture plan with a machine needing 5 networks) → checker `[]`.
- [ ] **Step 2–4:** RED → implement → `npx vitest run && npm run typecheck` green; `npx playwright test` green.
- [ ] **Step 5: Commit** `feat: compact generated layouts`

### Task 4: Pipes remember what they carry

**Files:** `src/model/types.ts`, `src/model/buildJson.ts`, `src/layout/build.ts`, `src/layout/grow.ts`, `src/editor/state.ts` (+ tests).

**Produces:** `PlacedBlock.net?: string`; `Build.networks?: { id: string; name: string; kind: 'fluid' | 'item' | 'power'; icon?: ResourceKey; tier?: PowerTier; flow?: number; conduit: string }[]`; generated conduits get `net`; slices/grow keep it; editor extras carry `networks`; hand-placed conduits have none.

- [ ] **Step 1: Failing tests:** `'every generated conduit names its network'`; `'networks round-trip through save/load; old builds without them still load'`; `'grown slices keep their pipe networks'`.
- [ ] **Step 2–5:** RED → implement → green → commit `feat: generated pipes remember what they carry`

### Task 5: Icons, hover highlight, legend

**Files:** create `src/editor/scene/PipeLabels.tsx`, `src/editor/labels.ts` (+ test); modify `src/editor/scene/Scene.tsx`, `src/editor/ui/InfoPanel.tsx`, `src/editor/ui/LineNotes.tsx`, `src/editor/ui/Toolbar.tsx`, `src/App.tsx`, `src/styles.css`, `e2e/editor.spec.ts`.

**Produces:**
- `labelSpots(build: Build): { net: string; pos: Vec3 }[]` — one spot per network per straight run of ≥ 3 cells, at most one per slice length, placed above the run's middle cell.
- `<PipeLabels>`: drei `Html` billboards with the network's `<Icon>` (power: ⚡ + tier) at each spot; hidden when the toolbar toggle **Show what's in pipes** is off (remembered per browser).
- Highlight: hovering a conduit with `net` highlights every block of that network and the machines it attaches to (emissive tint), and `InfoPanel` shows "Carries: <name> · <flow> · <pipe name>". Legend **What the pipes carry** in Line notes: one row per network with icon and name; clicking toggles a sticky highlight.
- [ ] **Step 1: Failing tests:** `labels.test.ts` — `'one label per lane per slice'` (oil line: label count ≤ lanes × slices + core networks), `'no labels for builds without networks'`. E2E: after Build in 3D, `line-notes` contains `What the pipes carry` and `Oil`; clicking the legend row adds `data-highlight` to the scene container; the toggle hides labels (`.pipe-label` count 0); hovering a hand-placed pipe in a fresh build shows no "Carries".
- [ ] **Step 2–4:** RED → implement → `npx playwright test && npx vitest run && npm run typecheck && npm run build` green.
- [ ] **Step 5: Commit** `feat: see what every pipe carries`

### Task 6: Screenshots and fresh schematics

- [ ] Before/after screenshots of the oil line (old roomy vs compact, labels on), export the full and one-slice schematics to the session scratchpad, hand the user the in-game checklist.
