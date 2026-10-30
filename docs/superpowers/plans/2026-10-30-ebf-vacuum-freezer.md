# Electric Blast Furnace and Vacuum Freezer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build in 3D lays out the Electric Blast Furnace (coils chosen from recipe heat, muffler on top) and the Vacuum Freezer block for block, like the three multiblocks it already builds.

**Architecture:** Two more structure functions in the `DEFINITIONS` table of `src/layout/multiblock.ts`. A new `buildable()` there is the one rule for "laid out as itself", used by `structureFor` and by `plan.ts`. A new port kind `muffler` gets its front cell kept clear by the layout and checked by the checker.

**Tech Stack:** TypeScript, Vitest (`npx vitest run`), Playwright e2e (`npx playwright test`).

**Spec:** `docs/superpowers/specs/2026-10-30-ebf-vacuum-freezer-design.md` (the earlier multiblock spec, `docs/superpowers/specs/2026-10-24-multiblocks-design.md`, describes the existing three).

## Global Constraints

- GT 5.09.54.183. EBF controller mID 1000, Vacuum Freezer controller mID 1002, LV Muffler Hatch mID 91 (block meta 1).
- Heat Proof casing `gregtech:gt.blockcasings` meta 11; Frost Proof casing `gregtech:gt.blockcasings2` meta 1; coils `gregtech:gt.blockcasings5` meta 0 Cupronickel / 1 Kanthal / 2 Nichrome.
- Coil heats: Cupronickel 1801, Kanthal 2701, Nichrome 3601. EBF heat = coil heat + 100 × (energy hatch tier − 2), hatch tiers LV 1, MV 2, HV 3. The recipe needs heat ≤ that.
- Coils stop at Nichrome. LCR and Oil Cracking Unit coils stay Cupronickel.
- Textures, recipe data and icons from the user's game are never committed: tests use made-up recipes only; `public/` stays untouched.
- Notes have no trailing full stop (match the existing notes). Numbers in notes use `formatNumber` from `src/calculator/format.ts` (2000 → "2,000").
- Match the surrounding code's style: comment density, terse helpers, GT source cited in doc comments for rules taken from GT.

## Review Focus

1. **Heat right at a coil's limit**: 1801 K on an MV hatch is Cupronickel, 1802 K on MV is Kanthal, 1901 K on HV is still Cupronickel. Pinned in Task 2.
2. **A too-hot EBF must be a stand-in everywhere** (plan key `marker_multiblock`, no power counted, no "single block" checker error), not half-built. Pinned in Task 3.
3. **A taller multiblock in the same line** (a 6-tall Distillation Tower) raises the core's height, so the cell above the muffler is inside the routing bounds and must still stay empty. Pinned in Task 4 (`placeMultiblocks` returns it; the layout keeps it clear).
4. **A Vacuum Freezer with many hatches** keeps 16 casings and its energy hatch. Pinned in Task 2.
5. **Muffler in the schematic** pastes facing up (`mFacing` 1) with mID 91. Pinned in Task 1.

---

### Task 1: Catalog blocks, controllers and the muffler hatch

**Files:**
- Modify: `src/catalog/entries.ts` (the `CASINGS`, `HATCHES` and `CONTROLLERS` lists, about lines 248-276)
- Test: `src/catalog/catalog.test.ts`, `src/export/schematic.test.ts`

**Interfaces:**
- Produces catalog keys: `casing_heat_proof`, `casing_frost_proof`, `coil_kanthal`, `coil_nichrome`, `hatch_muffler_lv`. Controllers `gt_1000`, `gt_1002` (through `generatedEntry` with `multiblock: true`) get meta 2 and their textures.

- [ ] **Step 1: Write the failing tests**

In `catalog.test.ts`:

```ts
it('has the EBF and Vacuum Freezer blocks', () => {
  expect(CATALOG.get('casing_heat_proof')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasings', meta: 11 });
  expect(CATALOG.get('casing_frost_proof')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasings2', meta: 1 });
  expect(CATALOG.get('coil_kanthal')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasings5', meta: 1 });
  expect(CATALOG.get('coil_nichrome')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasings5', meta: 2 });
  expect(CATALOG.get('hatch_muffler_lv')).toMatchObject({ kind: 'machine', mID: 91, meta: 1, tier: 'LV' });
  expect(CATALOG.get('hatch_muffler_lv')!.textures.front).toBe('blocks/iconsets/OVERLAY_MUFFLER.png');
});

it('EBF and Vacuum Freezer controllers wear their casing and front overlay', () => {
  const ebf = generatedEntry({ key: 'gt_1000', name: 'Electric Blast Furnace', mID: 1000, multiblock: true });
  expect(ebf).toMatchObject({ meta: 2, textures: { side: 'blocks/iconsets/MACHINE_HEATPROOFCASING.png', front: 'blocks/iconsets/OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE.png' } });
  const vf = generatedEntry({ key: 'gt_1002', name: 'Vacuum Freezer', mID: 1002, multiblock: true });
  expect(vf).toMatchObject({ meta: 2, textures: { side: 'blocks/iconsets/MACHINE_CASING_FROST_PROOF.png', front: 'blocks/iconsets/OVERLAY_FRONT_VACUUM_FREEZER.png' } });
  expect(CONTROLLER_TEXTURE_PATHS).toContain('blocks/iconsets/OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE.png');
});
```

In `schematic.test.ts`, following that file's existing helpers: a build holding one `hatch_muffler_lv` with `facing: 1` writes a tile entity with `mID` 91 and `mFacing` 1, and its block meta is 1.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/catalog/catalog.test.ts src/export/schematic.test.ts`
Expected: FAIL (`casing_heat_proof` undefined, etc.)

- [ ] **Step 3: Add the entries**

- `CASINGS`: `casingBlock` entries for the four blocks above, textures `MACHINE_HEATPROOFCASING`, `MACHINE_CASING_FROST_PROOF`, `MACHINE_COIL_KANTHAL`, `MACHINE_COIL_NICHROME`; pick a plain colour each (e.g. `#9a8f84`, `#c8dce8`, `#b5b0a0`, `#8f8a7a`). Names: "Heat Proof Machine Casing", "Frost Proof Machine Casing", "Kanthal Coil Block", "Nichrome Coil Block".
- `HATCHES`: `hatch('hatch_muffler_lv', 'LV Muffler Hatch', 91, 'LV', 'OVERLAY_MUFFLER')`.
- `CONTROLLERS`: `1000: { casing: 'MACHINE_HEATPROOFCASING', overlay: 'OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE' }`, `1002: { casing: 'MACHINE_CASING_FROST_PROOF', overlay: 'OVERLAY_FRONT_VACUUM_FREEZER' }`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/catalog src/export`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/catalog/entries.ts src/catalog/catalog.test.ts src/export/schematic.test.ts
git commit -m "feat(catalog): EBF and Vacuum Freezer casings, coils, muffler hatch and controllers"
```

---

### Task 2: The two structures, coil choice and the muffler port

**Files:**
- Modify: `src/model/types.ts:16` (`PortKind`), `src/model/buildJson.ts:10` (`PORT_KINDS`), `src/layout/types.ts` (`PlanMachine`), `src/layout/multiblock.ts`
- Test: `src/layout/multiblock.test.ts`, the existing buildJson test file (`src/model/buildJson.test.ts`)

**Interfaces:**
- Consumes: Task 1's catalog keys.
- Produces:
  - `PortKind = 'in' | 'out' | 'energy' | 'maintenance' | 'muffler'`.
  - `PlanMachine.heat?: number`: "Electric Blast Furnace: the heat its recipe needs, in kelvin (the dump's `specialValue`)".
  - In `multiblock.ts`:
    - `export const EBF_ID = 1000`
    - `export const COILS: readonly { key: string; name: string; heat: number }[]` (Cupronickel, Kanthal, Nichrome in that order, keys `coil_cupronickel`, `coil_kanthal`, `coil_nichrome`)
    - `export function ebfHeat(coilHeat: number, tier: string | undefined): number` (coil heat + 100 × (energy hatch tier − 2); the hatch tier is the one `energyHatch(tier)` picks, so ULV counts as LV)
    - `export function coilFor(heat: number, tier: string | undefined): (typeof COILS)[number] | undefined` (the first coil whose `ebfHeat` reaches `heat`)
    - `export function buildable(mID: number, tier: string | undefined, heat = 0): boolean` (a definition exists, an energy hatch exists for the tier, and for the EBF a coil reaches the heat)
  - `structureFor(pm)` returns `undefined` unless `buildable(pm.machine.mID, pm.tier, pm.heat)`.

- [ ] **Step 1: Write the failing tests** (in `multiblock.test.ts`, using its `mb`, `countKey`, `at` helpers)

```ts
const ebf = (heat: number, over: Partial<PlanMachine> = {}) =>
  structureFor(mb(1000, { inputs: ['item:dust', 'fluid:oxygen'], outputs: ['item:ingot'], heat, ...over }));

it('an EBF is 3x3x4: heat proof bottom with the controller, two coil rings, a muffler facing up on top', () => {
  const s = ebf(1000, { tier: 'MV' })!;
  expect(s.size).toEqual([3, 4, 3]);
  expect(at(s, 1, 0, 2)?.key).toBe('gt_1000');
  for (const y of [1, 2]) {
    expect(at(s, 1, y, 1)).toBeUndefined();
    expect(s.blocks.filter((b) => b.rel[1] === y && b.key === 'coil_cupronickel')).toHaveLength(8);
  }
  expect(s.blocks.filter((b) => b.rel[1] === 3 && b.key === 'casing_heat_proof')).toHaveLength(8);
  expect(s.ports.find((p) => p.kind === 'muffler')).toMatchObject({ rel: [1, 3, 1], facing: 1, key: 'hatch_muffler_lv', keys: [] });
  expect(s.ports.filter((p) => p.kind !== 'muffler').every((p) => p.rel[1] === 0)).toBe(true);
});

it("an EBF's bottom layer: energy front right, maintenance back, buses at the sides, fluids front left", () => {
  const s = ebf(1000, { tier: 'MV', outputs: ['item:ingot', 'fluid:co2'] })!;
  const port = (kind: string, key?: string) => s.ports.find((p) => p.kind === kind && (!key || p.key === key));
  expect(port('energy')).toMatchObject({ rel: [2, 0, 2], facing: 3, key: 'hatch_energy_mv' });
  expect(port('maintenance')).toMatchObject({ rel: [1, 0, 0], facing: 2 });
  expect(port('in', 'bus_input_lv')).toMatchObject({ rel: [0, 0, 1], facing: 4, keys: ['item:dust'] });
  expect(port('out', 'bus_output_lv')).toMatchObject({ rel: [2, 0, 1], facing: 5, keys: ['item:ingot'] });
  expect(port('in', 'hatch_input_lv')).toMatchObject({ rel: [0, 0, 2], facing: 3, keys: ['fluid:oxygen'] });
  expect(port('out', 'hatch_output_lv')).toMatchObject({ rel: [0, 0, 0], facing: 4, keys: ['fluid:co2'] });
});

it('the coil is the cheapest that reaches the recipe heat with the energy hatch bonus', () => {
  const coil = (heat: number, tier: string) => ebf(heat, { tier })?.blocks.find((b) => b.rel[1] === 1)?.key;
  expect(coil(1801, 'MV')).toBe('coil_cupronickel');
  expect(coil(1802, 'MV')).toBe('coil_kanthal');
  expect(coil(1901, 'HV')).toBe('coil_cupronickel');
  expect(coil(2801, 'HV')).toBe('coil_kanthal');
  expect(coil(2802, 'HV')).toBe('coil_nichrome');
  expect(coil(1750, 'LV')).toBe('coil_kanthal'); // LV hatch: 1801 - 100
});

it('an EBF hotter than Nichrome can reach has no structure', () => {
  expect(ebf(3701, { tier: 'HV' })).toBeDefined();
  expect(ebf(3702, { tier: 'HV' })).toBeUndefined();
  expect(buildable(1000, 'HV', 3702)).toBe(false);
  expect(buildable(1000, 'HV')).toBe(true);
  expect(ebfHeat(3601, 'HV')).toBe(3701);
});

it('a vacuum freezer is 3x3x3 frost proof, hollow, controller at the middle front', () => {
  const s = structureFor(mb(1002, { tier: 'MV', inputs: ['item:hot'], outputs: ['item:cold'] }))!;
  expect(s.size).toEqual([3, 3, 3]);
  expect(at(s, 1, 1, 1)).toBeUndefined();
  expect(at(s, 1, 1, 2)?.key).toBe('gt_1002');
  expect(s.ports.find((p) => p.kind === 'maintenance')).toMatchObject({ rel: [1, 0, 0], facing: 2 });
  expect(s.ports.find((p) => p.kind === 'energy')).toMatchObject({ rel: [0, 1, 2], facing: 3 });
  expect(countKey(s, 'casing_frost_proof') + s.ports.length + 1).toBe(26);
});

it('a vacuum freezer with too many hatches keeps 16 casings and its energy hatch, and says so', () => {
  const fluids = Array.from({ length: 10 }, (_, i) => `fluid:f${i}`);
  const s = structureFor(mb(1002, { tier: 'MV', inputs: fluids, outputs: ['item:cold'] }))!;
  expect(countKey(s, 'casing_frost_proof')).toBe(16);
  expect(s.ports.some((p) => p.kind === 'energy')).toBe(true);
  expect(s.notes.length).toBeGreaterThan(0);
});
```

In the buildJson test file: a block with `port: { kind: 'muffler', keys: [] }` survives serialize → parse.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/layout/multiblock.test.ts src/model`
Expected: FAIL (`buildable` not exported; no EBF structure)

- [ ] **Step 3: Implement**

- `PortKind`, `PORT_KINDS`, `PlanMachine.heat` as in Interfaces.
- `electricBlastFurnace(pm, tier)`: the shape and spots in the spec's "As built" (fluid slots `[0,0,2]` facing 3, `[0,0,0]` facing 4, `[2,0,0]` facing 5; inputs before outputs; past 3 a note). Coil from `coilFor(pm.heat ?? 0, pm.tier)`. Doc comment cites `MTEElectricBlastFurnace` (shape, heat formula) and `MTEHatchMuffler.polluteEnvironment` (air in front).
- `vacuumFreezer(pm, tier)`: every cell but `[1,1,1]` Frost Proof; controller `[1,1,2]`; maintenance `[1,0,0]` facing 2; then the LCR's 14 spots in the LCR's order, energy first, inputs, outputs, at most 8 used (16 casings remain, `MTEVacuumFreezer.checkMachine: checkCasingMin(errors, mCasing, 16)`). Move the LCR's spot list to one module-level constant both use, and its "No room on the reactor…" note becomes per-machine ("No room on the vacuum freezer for another in hatch").
- `DEFINITIONS` gets `1000` and `1002`; `structureFor` goes through `buildable`; `lockOutputs` still applies to both.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/layout src/model`
Expected: PASS (all existing multiblock tests too)

- [ ] **Step 5: Commit**

```bash
git add src/model/types.ts src/model/buildJson.ts src/model/buildJson.test.ts src/layout/types.ts src/layout/multiblock.ts src/layout/multiblock.test.ts
git commit -m "feat(layout): Electric Blast Furnace and Vacuum Freezer structures, coils from recipe heat"
```

---

### Task 3: Plan — heat, one buildable rule, notes

**Files:**
- Modify: `src/layout/plan.ts` (`perNode`, `machine`, `planned`, `multiblockNotes`)
- Test: `src/layout/plan.test.ts`

**Interfaces:**
- Consumes: `EBF_ID`, `buildable`, `coilFor`, `ebfHeat`, `COILS` from Task 2; `PlanMachine.heat`.
- Produces: a planned EBF (`machine.mID` 1000) carries `heat` = its recipe's `specialValue`, whether laid out or not.

- [ ] **Step 1: Write the failing tests**

Give `towerSetup` / `towerPlan` an optional `specialValue = 0` parameter put on its recipe (so `towerPlan(1000, 2, 'modular', 120, 2000)` is an MV EBF needing 2,000 K; the recipe's shape doesn't matter to the plan).

```ts
test('an EBF is planned as itself with its recipe heat, and the notes name its coils and muffler', async () => {
  const p = await towerPlan(1000, 2, 'modular', 120, 2000);
  expect(inPlan(p)).toMatchObject({ key: 'gt_1000', heat: 2000 });
  expect(p.notes).toContain('The Distillation Tower uses Kanthal Heating Coils (its recipe needs 2,000 K)');
  expect(p.notes).toContain("Keep the block above the Distillation Tower's muffler hatch empty");
});

test('an EBF hotter than Nichrome keeps the stand-in, says why, and uses no power', async () => {
  const p = await towerPlan(1000, 3, 'modular', 120, 4500);
  expect(inPlan(p).key).toBe('marker_multiblock');
  expect(p.notes).toContain("The Distillation Tower's recipe needs 4,500 K; Nichrome coils with an HV energy hatch give 3,701 K. Build it yourself with better coils");
  expect(p.notes.some((n) => n.includes("multiblocks aren't laid out yet"))).toBe(false);
  expect(p.power.demand.HV ?? 0).toBe(0);
});
```

(The machine's name in these fixtures is "Distillation Tower"; the notes use `i.ref.name`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/layout/plan.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- `perNode` adds `heat: recipe?.specialValue ?? 0`.
- `machine()` puts `heat` on the base `pm` when `i.ref.mID === EBF_ID`.
- `planned(i)` = `i.ref.multiblock && buildable(i.ref.mID, i.tier, i.heat)` (drop the `MULTIBLOCK_IDS` import if unused).
- `multiblockNotes`: an EBF that is `buildable` without its heat but not with it gets the too-hot note in place of "Build the … yourself"; a planned EBF adds the coil note (coil from `coilFor`) and the muffler note after the maintenance note. Exact texts are in the tests.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/layout`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/layout/plan.ts src/layout/plan.test.ts
git commit -m "feat(layout): plan EBFs from recipe heat, with coil and muffler notes"
```

---

### Task 4: Muffler stays uncovered — layout and checker

**Files:**
- Modify: `src/layout/tidy.ts` (`placeMultiblocks`, and the core loop that builds `keepClear`), `src/layout/check.ts`
- Test: `src/layout/multiblockLayout.test.ts`, `src/layout/check.test.ts`

**Interfaces:**
- Consumes: the `muffler` port kind (Task 2), EBF and freezer structures.
- Produces: `placeMultiblocks(...)` returns `{ placed, width, clear: string[] }`: `posKey`s of the cell in front of every muffler port. `buildTidy`'s core adds them to `keepClear` so no pipe or cable is routed there.

- [ ] **Step 1: Write the failing tests**

`check.test.ts` (in the `multiblock ports` describe, extending its fixture style): an EBF build (`gt_1000` controller with role, an energy hatch port, a `hatch_muffler_lv` port `{ kind: 'muffler', keys: [] }` facing 1) with a pipe in the cell above the muffler gives the problem `"The Electric Blast Furnace's muffler hatch is covered; it needs air above it"` (register `gt_1000` named "Electric Blast Furnace" as the fixture does for `gt_1126`); without that pipe, no such problem.

`multiblockLayout.test.ts`:

```ts
const ebf = (o: Partial<PlanMachine> = {}) => multi('ebf', 1000, 'Electric Blast Furnace', { inputs: ['item:dust'], outputs: ['item:hot'], heat: 1500, ...o });
const freezer = (o: Partial<PlanMachine> = {}) => multi('vf', 1002, 'Vacuum Freezer', { inputs: ['item:hot'], outputs: ['item:ingot'], ...o });

it('placeMultiblocks keeps the cell above an EBF muffler clear', () => {
  const { placed, clear } = placeMultiblocks(machineUnits([ebf()]), 0, new Set());
  const muffler = placed.find((p) => p.port?.kind === 'muffler')!;
  expect(muffler.facing).toBe(1);
  expect(clear).toEqual([posKey(addVec(muffler.pos, DIRS[1]))]);
});

it('an EBF feeding a vacuum freezer builds, checks clean, and nothing sits above the muffler', () => {
  // The mixers line with the EBF and freezer added: dust (in marker) -> ebf -> hot -> vf -> ingot (out marker). No machine
  // takes the mixers' Oil here, so plan()'s Oil network must end at an `out:oil` marker: extend plan() so its Oil
  // network's consumers fall back to ['out:oil'] when no machine takes Oil, and pass that marker.
  const p = plan([ebf(), freezer()], [
    item('item:dust', ['in:dust'], ['ebf']), item('item:hot', ['ebf'], ['vf']), item('item:ingot', ['vf'], ['out:ingot']),
  ], [marker('out:oil', 'fluid:oil', 'out'), marker('in:dust', 'item:dust', 'in', 'item'), marker('out:ingot', 'item:ingot', 'out', 'item')]);
  const b = buildLine(p, 'ebf');
  expect(checkLine(b.build, p)).toEqual([]);
  const muffler = b.build.blocks.find((x) => x.port?.kind === 'muffler')!;
  expect(b.build.blocks.some((x) => posKey(x.pos) === posKey(addVec(muffler.pos, DIRS[1])))).toBe(false);
});

it('beside a taller Distillation Tower the muffler is still uncovered', () => {
  // the tower plan plus an EBF fed from a marker; same assertions as above.
});
```

Follow the file's existing `plan()`, `item`/`fluid`/`marker` helper shapes (add an `item` network helper beside `fluid` if missing).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/layout/check.test.ts src/layout/multiblockLayout.test.ts`
Expected: FAIL (`clear` undefined; no muffler problem)

- [ ] **Step 3: Implement**

- `placeMultiblocks`: collect the front of each `muffler` port into `clear`. Its doc comment says the muffler's front is kept as air.
- The core loop in `buildTidy`: after `placeMultiblocks(...)`, add `clear` to `keepClear`.
- `check.ts`: for every block whose `port.kind === 'muffler'`, any block in the cell at `pos + DIRS[facing]` gives the problem above (name = the multiblock's machine name via its role, as the other multiblock problems find it).

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add src/layout/tidy.ts src/layout/check.ts src/layout/check.test.ts src/layout/multiblockLayout.test.ts
git commit -m "feat(layout): keep the EBF muffler uncovered, and check it"
```

---

### Task 5 (controller, not a subagent): Real-data check

- [ ] Scratch probe (outside the repo, like `rev/ethylene.mts`): the user's dump, an EBF steel recipe (Kanthal-free) and a hot-ingot recipe into a Vacuum Freezer (e.g. a hot ingot needing Kanthal: Titanium-class heat ≤ 2,801 with HV), straight and modular; `buildLine` succeeds, `checkLine` is `[]`, the coils match the heat, and the muffler's cell above is empty.
- [ ] Load the built line in the 3D view (Playwright MCP, file under `.playwright-mcp/`) and screenshot: EBF with coils and muffler on top, freezer beside it, textures showing.
- [ ] `npx tsc -b` (then delete `tsconfig.tsbuildinfo`), `npx vitest run`, `npx playwright test`.
