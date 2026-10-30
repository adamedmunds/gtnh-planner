# Multiblocks in Build in 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay out real Distillation Towers, Large Chemical Reactors and Oil Cracking Units block for block in tidy
lines, with pipes and power to the right hatches, so the pasted schematic is a working machine.

**Architecture:** A pure `structureFor(pm)` describes each multiblock as blocks (casings, coils, controller) and
*ports* (hatches with a fixed outward facing and the resources they carry). The tidy core places each structure
north of the core, fronts facing the line, and routes ports like machine faces. Checker and cable-loss model learn
that only a multiblock's ports carry its pipes and only its energy hatch takes power.

**Tech Stack:** TypeScript, Vitest, existing layout/router (`src/layout`), catalog (`src/catalog`), schematic export.

**Spec:** `docs/superpowers/specs/2026-10-24-multiblocks-design.md`

## Global Constraints

- GT 5.09.54.183 values, verified in source and the user's world:
  - Casings: `gregtech:gt.blockcasings4` meta 1 (Clean Stainless Steel), `gregtech:gt.blockcasings8` meta 0
    (Chemically Inert), meta 1 (PTFE Pipe Casing), `gregtech:gt.blockcasings5` meta 0 (Cupronickel coil).
  - Controllers (`gregtech:gt.blockmachines`, block meta **2**): Distillation Tower mID 1126, Large Chemical Reactor
    1169, Oil Cracking Unit 1160.
  - Hatches (block meta 1): input hatch LV 51, output hatch LV 61, input bus LV 71, output bus LV 81, energy hatch
    LV/MV/HV 41/42/43, maintenance hatch 90.
- Output hatches and buses push out of their front only; energy hatches take power through their front only; input
  hatches and buses take from any face. Every hatch faces outward, its pipe or cable on its front.
- Distillation Tower: height = fluid outputs + 1, at least 3; bottom layer solid 3×3 with the controller front centre;
  each upper layer a ring of 8 with an air centre except the top, whose centre is a casing; layer *n* above the bottom
  holds the output hatch for the recipe's *n*-th fluid output, in recipe order; at least `7 × height − 5` casings.
- Large Chemical Reactor: 3×3×3 Chemically Inert, PTFE Pipe Casing in the centre, **exactly one** Cupronickel coil on
  one `x` spot (top centre, bottom centre, middle-layer left / right / back centre), at least 8 casings.
- Oil Cracking Unit: 5 wide × 3 tall × 3 deep, columns `l c m c r`; 16 Cupronickel coils in the `c` columns (the middle
  layer's middle row is air across `c m c`); hydrocarbon in on one side column, cracked fluid out on the opposite side
  column, hydrogen or steam in on the middle column.
- Input/output hatches and buses are LV; the energy hatch matches the recipe's tier; one maintenance hatch.
- As many of each multiblock as the plan's count; they stand beside the core and are never copied into slices.
- Textures, recipe data and icons from the user's game are never committed.

## Review Focus

1. A Distillation Tower recipe that also outputs an item: the bottom layer gets an output bus, and the item still
   reaches its consumer or marker. (Task 2, Task 5)
2. A Distillation Tower recipe with a single fluid output: a 3-tall tower whose second upper layer has an output hatch
   nothing comes out of, and the checker doesn't call that hatch broken. (Task 2, Task 4)
3. A line needing two towers: both are built, and each tower's layer-*n* hatch is on the same network. (Task 5)
4. A multiblock recipe above HV, or a multiblock without a definition: the line keeps today's one-block stand-in and
   "build it yourself" note, never a crash. (Task 3)
5. An Oil Cracking Unit fed steam instead of hydrogen: the steam goes to the middle column, the hydrocarbon to a side
   column. (Task 2)

---

### Task 1: Catalog, 3D view and schematic for multiblock parts

**Files:**
- Modify: `src/catalog/types.ts` (add `'casing'` to `Kind`; `GeneratedMachine.multiblock?: boolean`)
- Modify: `src/catalog/entries.ts` (casing, coil and hatch entries; multiblock controllers in `generatedEntry`)
- Modify: `src/editor/scene/Scene.tsx` (draw `casing` like machines), `src/editor/ui/Palette.tsx` (group
  `'Multiblock parts'`)
- Modify: `src/export/schematic.ts` only if a test shows casings or hatches need it
- Test: `src/catalog/catalog.test.ts`, `src/export/schematic.test.ts`, `src/model/connections.test.ts`

**Interfaces:**
- Produces catalog keys: `casing_clean_stainless`, `casing_chemically_inert`, `casing_ptfe_pipe`, `coil_cupronickel`
  (kind `casing`, `vanilla` = block name, `meta` as above); `hatch_input_lv`, `hatch_output_lv`, `bus_input_lv`,
  `bus_output_lv`, `hatch_energy_lv`, `hatch_energy_mv`, `hatch_energy_hv` (with `tier`), `hatch_maintenance` (kind
  `machine`, group `'Multiblock parts'`).
- `generatedEntry({ key, name, mID, tier, multiblock: true })` for mID 1126 / 1169 / 1160: `meta: 2`, textures of the
  multiblock's casing with front overlay `OVERLAY_FRONT_DISTILLATION_TOWER` / `…_LARGE_CHEMICAL_REACTOR` /
  `…_OIL_CRACKER`.
- Textures (all in the GT jar under `blocks/iconsets/`): `MACHINE_CASING_CLEAN_STAINLESSSTEEL`,
  `MACHINE_CASING_CHEMICALLY_INERT`, `MACHINE_CASING_PIPE_POLYTETRAFLUOROETHYLENE`, `MACHINE_COIL_CUPRONICKEL`; hatch
  overlays `OVERLAY_PIPE_IN`, `OVERLAY_PIPE_OUT`, `OVERLAY_ENERGY_IN_MULTI`, `OVERLAY_MAINTENANCE`.

- [ ] **Step 1: Write the failing tests**
  - catalog: `test.each` rows `['hatch_input_lv', 51, 1, 'machine']`, `['hatch_output_lv', 61, 1, 'machine']`,
    `['bus_input_lv', 71, 1, 'machine']`, `['bus_output_lv', 81, 1, 'machine']`, `['hatch_energy_hv', 43, 1, 'machine']`,
    `['hatch_maintenance', 90, 1, 'machine']`; `getEntry('casing_clean_stainless')` matches
    `{ kind: 'casing', vanilla: 'gregtech:gt.blockcasings4', meta: 1 }` (and the other three casings likewise);
    `registerMachines([{ key: 'gt_1126', name: 'Distillation Tower', mID: 1126, tier: 'HV', multiblock: true }])` then
    `getEntry('gt_1126')!.meta === 2` and its `textures.front` ends with `OVERLAY_FRONT_DISTILLATION_TOWER.png`.
  - schematic: `'multiblock parts export: casings as their GT block and meta, hatches as GT machines facing out'`: a
    build of `casing_clean_stainless` at [0,0,0] and `hatch_output_lv` at [1,0,0] facing 3 → mapping has
    `gregtech:gt.blockcasings4`, `Data[0] === 1`, one tile entity with `mID` 61 and `mFacing` 3.
  - connections: `'a pipe next to a casing does not connect to it'`: `casing_clean_stainless` beside
    `bronze_pipe_small` → the pipe's mask is 0.
- [ ] **Step 2: Run** `npx vitest run src/catalog src/export src/model` — expect the new tests to fail.
- [ ] **Step 3: Implement** the entries and kind. `Scene.tsx` renders `kind === 'casing'` with `MachineMesh`;
  `Palette` lists `'Multiblock parts'` (casings and hatches) after Item pipes.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc -b` (then `rm tsconfig.tsbuildinfo`) — all pass; run
  `npm run textures` and confirm no "missing in jar" lines.
- [ ] **Step 5: Commit** `feat(catalog): multiblock casings, coils, hatches and controllers`.

### Task 2: Multiblock structures

**Files:**
- Create: `src/layout/multiblock.ts`
- Test: `src/layout/multiblock.test.ts`

**Interfaces:**
- Consumes: Task 1 catalog keys; `PlanMachine` (`machine.mID`, `inputs`, `outputs`, `tier`, `fluidOutputs` from
  Task 3 — declare the optional field on `PlanMachine` in `src/layout/types.ts` in this task).
- Produces:
  ```ts
  // in src/model/types.ts (shared with PlacedBlock in Task 4):
  export type PortKind = 'in' | 'out' | 'energy' | 'maintenance';
  // in src/layout/multiblock.ts:
  export interface Port { rel: Vec3; facing: Facing; kind: PortKind; key: string /* hatch catalog key */; keys: ResourceKey[] }
  export interface Structure { size: Vec3; blocks: { rel: Vec3; key: string }[]; ports: Port[]; notes: string[] }
  /** Undefined for multiblocks without a definition (or above HV): they keep the one-block stand-in. */
  export function structureFor(pm: PlanMachine): Structure | undefined;
  export const MULTIBLOCK_IDS: readonly number[]; // [1126, 1169, 1160]
  ```
  Coordinates: `rel` is `[x, y, z]` with `x` 0..w−1, `y` 0..h−1 (bottom first), `z` 0..d−1 where **`z = d−1` is the
  front row**, facing `+z` (side 3). Front ports face 3; ports on the `x = 0` side face 4, on `x = w−1` face 5, on the
  back (`z = 0`) face 2. `blocks` includes the controller (`key` = `pm.key`, at front centre of the controller layer)
  and every casing/coil; a cell holding a port is not also in `blocks`; air cells are in neither.
- Port placement (our defaults; the builder may move a port within GT's rules if routing needs it):
  - Distillation Tower: fluid input hatch front-left of the bottom layer; energy hatch front-right; output hatch for
    fluid *n* at the front centre of layer *n*; maintenance at the back centre of the bottom layer; item input bus /
    output bus on the bottom layer's `x = 0` / `x = 2` side centre.
  - Large Chemical Reactor: controller front centre of the middle layer; ports fill the front face in the order
    middle-left, middle-right, bottom-left, bottom-right, bottom-centre, top-left, top-right, top-centre (inputs, then
    outputs, then energy), then the side faces; maintenance on the back; the coil at the middle layer's back centre.
  - Oil Cracking Unit: hydrocarbon input hatch on the `x = 0` front column, output hatch on the `x = 4` front column,
    hydrogen/steam input on the `x = 2` front column (bottom), energy on the `x = 2` front column (top), maintenance on
    the back. The cracking fluid is the input whose key is `fluid:hydrogen` or `fluid:steam` (check the user's dump for
    the exact keys and list them in a constant).
  - Every input/output resource gets its own hatch or bus: one hatch per fluid, one bus for all of a direction's items.

- [ ] **Step 1: Write the failing tests** (in `multiblock.test.ts`, synthetic `PlanMachine`s)
  - `'a distillation tower is as tall as its fluid outputs plus one'`: 5 fluid outputs → `size` `[3, 6, 3]`; layers
    1–4 have air at the centre (no block, no port at `[1, y, 1]`); the top layer's centre is a
    `casing_clean_stainless`; casings ≥ `7 * 6 - 5`.
  - `'each output hatch sits on the layer of its fluid, in recipe order'`: for n = 1..5, exactly one `out` port with
    `rel[1] === n`, and its `keys` equal `[fluidOutputs[n - 1]]`.
  - `'a one-output tower is still three tall, with an empty output hatch'`: 1 fluid output → height 3, two `out` ports
    (layers 1 and 2), the layer-2 one with `keys: []`.
  - `'a tower with an item output gets an output bus on the bottom layer'`: bus port kind `out`, key `bus_output_lv`,
    `rel[1] === 0`.
  - `'the energy hatch matches the recipe tier'`: HV recipe → port kind `energy`, key `hatch_energy_hv`.
  - `'a large chemical reactor has exactly one coil and its PTFE pipe in the centre'`: `size` `[3,3,3]`, one
    `coil_cupronickel`, `casing_ptfe_pipe` at `[1,1,1]`, ≥ 8 `casing_chemically_inert`.
  - `'an oil cracker takes hydrocarbon and cracking fluid on different columns'`: 16 coils; the hydrogen port has
    `rel[0] === 2`; the hydrocarbon port `rel[0] === 0`; the output port `rel[0] === 4`; same with steam.
  - `'unknown multiblocks and ones above HV have no structure'`: mID 9999 → `undefined`; a tower with `tier: 'EV'` →
    `undefined`.
  - Every structure: no two entries share a cell; every port faces out of the box.
- [ ] **Step 2: Run** `npx vitest run src/layout/multiblock.test.ts` — fails (module missing).
- [ ] **Step 3: Implement** `structureFor` and the three definitions in `src/layout/multiblock.ts`, each definition a
  small function returning its `Structure`, so the next multiblock is one more function in the same table.
- [ ] **Step 4: Run** the test file — passes.
- [ ] **Step 5: Commit** `feat(layout): multiblock structures for the distillation tower, LCR and oil cracker`.

### Task 3: Plan multiblocks as real machines

**Files:**
- Modify: `src/layout/plan.ts`, `src/layout/types.ts`, `src/layout/region.ts` (`tierOf`)
- Test: `src/layout/plan.test.ts`

**Interfaces:**
- Consumes: `structureFor`, `MULTIBLOCK_IDS` (Task 2).
- Produces: a planned multiblock with a definition (mID in `MULTIBLOCK_IDS`, tier ≤ HV) has `key: 'gt_<mID>'`,
  `machine.multiblock: true`, `multiblock: true`, `fluidOutputs: ResourceKey[]` (the recipe's fluid outputs in recipe
  order, from `recipe.outputs`), and counts toward power: `tierOf(pm)` returns its tier, and it's in the users/demand
  in `planLine`. Others keep `key: 'marker_multiblock'` and the "build it yourself" note.
- Notes for a planned multiblock: `Fix the <name>'s maintenance hatch with tools after pasting it`; for LCR / cracker
  also `The <name>'s Heating Coils are Cupronickel; better ones can be swapped in`; a kept circuit says
  `Put a Programmed Circuit N in the <name>'s controller or input bus`.

- [ ] **Step 1: Write the failing tests** in `plan.test.ts`, extending the fixture with a Distillation Tower map whose
  machine is `{ mID: 1126, multiblock: true, tier: 3 }` and a recipe `oil → 5 fluids` (keys in a fixed order):
  - `'a distillation tower is planned as itself, its fluids in recipe order'`: `key === 'gt_1126'`,
    `fluidOutputs` equals the recipe's fluid output keys in order, `power.demand.HV > 0`.
  - `'a multiblock with no definition keeps the stand-in'`: same with mID 9999 → `key === 'marker_multiblock'` and the
    "build it yourself" note.
  - `'a planned multiblock adds the maintenance note'`.
  - `'the core's slice limit counts its multiblocks'`: a modular plan whose tower covers 2 slices' worth of Oil has
    `coreServes === 2` (multiblocks are sized for the slices built; growing past that warns, it doesn't add towers).
- [ ] **Step 2: Run** `npx vitest run src/layout/plan.test.ts` — fails.
- [ ] **Step 3: Implement.** In `region.ts`, `tierOf` returns the tier for multiblocks with a structure.
- [ ] **Step 4: Run** `npx vitest run` — all pass (fix tests whose expectations assumed multiblocks use no power).
- [ ] **Step 5: Commit** `feat(plan): plan supported multiblocks as real machines with power`.

### Task 4: Checker and cable loss understand ports

**Files:**
- Modify: `src/model/types.ts` (`PlacedBlock.port?: { kind: PortKind; keys: string[] }`), `src/model/buildJson.ts`
  (round-trip `port`), `src/layout/check.ts`, `src/layout/loss.ts`
- Test: `src/layout/check.test.ts`, `src/layout/loss.test.ts`

**Interfaces:**
- Consumes: `PortKind` (Task 2).
- Produces checker rules:
  - For a role with any `port` blocks, a network's endpoints are only its ports: producing → an `out` port whose
    `keys` include the network's key, through its `facing`; consuming → an `in` port with the key, any face. A port
    with empty `keys` needs no pipe.
  - Power: an energy-hatch port takes power only through its `facing` and must be fed at most its catalog tier;
    "No power reaches" applies to it, not to the controller, casings or other hatches.
- Cable loss: of a multiblock's blocks, only its energy hatch draws (the plan machine's `eut`), from its facing.

- [ ] **Step 1: Write the failing tests** with hand-made builds (a 1×1 "multiblock" of a controller `gt_1126`, an
  `in` port and two `out` ports, pipes and an HV cable from a power marker):
  - `'a multiblock passes when each port has its own pipe'` → `checkLine` returns `[]`.
  - `'a multiblock output pipe on the wrong hatch is caught'` → a message naming the fluid that can't get out.
  - `'an energy hatch powered from its side is not powered'` → `No power reaches the …Energy Hatch…`.
  - `'an output hatch with nothing to output needs no pipe'` → no problem for an `out` port with `keys: []`.
  - loss: `'only the energy hatch of a multiblock draws power'` → per-machine loss has one entry for the role.
- [ ] **Step 2: Run** `npx vitest run src/layout/check.test.ts src/layout/loss.test.ts` — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` — all pass.
- [ ] **Step 5: Commit** `feat(check): multiblock ports in the checker and cable loss`.

### Task 5: Place and route multiblocks in the tidy core

**Files:**
- Modify: `src/layout/region.ts` (`Unit.port`, `Unit.fixed`; `routeRegion` honours fixed facings and port ends;
  `unitBlock` copies `port`), `src/layout/tidy.ts` (place structures; widen the core; region bounds; power sizing)
- Test: `src/layout/multiblockLayout.test.ts`

**Interfaces:**
- Consumes: `structureFor` (Task 2), `PlacedBlock.port` and checker rules (Task 4), planned multiblocks (Task 3).
- Produces:
  - `Unit.port?: { kind: PortKind; keys: string[] }` and `Unit.fixed?: boolean`: `routeRegion` keeps a fixed unit's
    `facing` and reserves the cell in front of a port for its network; a port is an end of each network whose keys it
    carries (mode `'facing'`; energy ports end their tier's cable on `'facing'`). Units with `port` are never directly
    powered by a transformer.
  - `placeMultiblocks(units: Unit[], xStart: number, taken: Set<string>): { placed: Placed[]; width: number }` in
    `tidy.ts`: each multiblock unit with a structure becomes its blocks and ports (roles: the unit's role for the
    controller and ports; none for casings), side by side along `x` from `xStart` with one-block gaps, back row at
    `z = TIDY_BOUNDS.zMin − depth`, front row at `z = TIDY_BOUNDS.zMin − 1`, fronts facing `+z`.
  - `withCore` makes the core at least as long as the multiblocks' total width, extends the region's `min`/`max` to
    include them, and counts multiblock EU/t in `powerEachRegion` / `powerEachVoltage` (remove the `!m.multiblock`
    filters there and in `transformersFor`/`stepUpsFor` inputs).

- [ ] **Step 1: Write the failing tests** (synthetic straight plans like `stepUp.test.ts`, outside HV power with a
  power marker):
  - `'a distillation tower is laid out whole, each fluid out of its own layer'`: one tower (5 fluids, markers for each
    output) → `buildLine` succeeds; `checkLine` → `[]`; 6 × 3 × 3 footprint present; for each n the `out` port block
    on layer n has `port.keys[0] === fluidOutputs[n - 1]`.
  - `'two towers are both built and share each layer's network'`: `count: 2` → two controllers `gt_1126`; check passes.
  - `'a tower with an item output gets its item out'`: the item reaches its marker; check passes.
  - `'a large chemical reactor and an oil cracker lay out and pass the checker'`: one each, with inputs/outputs and
    markers.
  - `'the energy hatch is cabled to the line's power'`: the energy hatch block has a cable of its tier on its facing.
  - `'multiblocks never touch the slices'`: modular plan with 2 slices + a tower → every multiblock block's `x` is
    inside the core's range.
- [ ] **Step 2: Run** `npx vitest run src/layout/multiblockLayout.test.ts` — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc -b` (then `rm tsconfig.tsbuildinfo`) and `npx playwright test` — all
  pass.
- [ ] **Step 5: Commit** `feat(layout): place and route real multiblocks beside the core`.

### Task 6: Verify on the user's own line

**Files:** none committed (probe scripts stay in the scratchpad; recipe data stays local).

- [ ] **Step 1:** Write a local probe (like `rev/cbd.mts`) that loads `public/data/recipes.json.gz`, builds the user's
  chain: Distillation Tower recipe → Sulfuric Light Fuel at the rate from their screenshot (137 L/s), and runs
  `planLine` → `buildLine` → `checkLine`, printing the build's notes and multiblock blocks.
  Expected: it builds, `checkLine` is `[]`, one 6-tall tower with its five output hatches in recipe order.
- [ ] **Step 2:** Repeat with the Oil Berry line rate that needs two towers (≈557 L/s Oil). Expected: two towers.
- [ ] **Step 3:** In the browser (dev server), Build in 3D shows the tower with its textures; take a screenshot for the
  user.
- [ ] **Step 4:** Update the spec if anything moved (port positions), commit `docs: multiblocks as built`.
