# Pyrolyse Oven Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build in 3D lays out the craftable Pyrolyse Oven (mID 15546) block for block, with Kanthal coils, its muffler kept open, and the two Steel Frame Boxes shown in 3D but left out of the schematic. The Calculator stops defaulting to the legacy oven.

**Architecture:** One more structure function in `DEFINITIONS` (`src/layout/multiblock.ts`). Four new catalog blocks, two of them with new catalog flags (`tint`, `notInSchematic`). The schematic writer skips `notInSchematic` blocks and refuses metadata above 255. The plan's notes generalise the EBF muffler note. `machineOptions` drops machines replaced by another on the same map.

**Tech Stack:** TypeScript, Vitest (`npx vitest run`), Playwright e2e (`npx playwright test`).

**Spec:** `docs/superpowers/specs/2026-10-30-pyrolyse-oven-design.md`. The existing multiblocks are described in `2026-10-24-multiblocks-design.md` and `2026-10-30-ebf-vacuum-freezer-design.md`.

## Global Constraints

- GT 5.09.54.183. The new Pyrolyse Oven is controller mID **15546**; the legacy one is **1159** and gets no structure. LV Muffler Hatch is mID 91 (`hatch_muffler_lv`, already in the catalog).
- Blocks:
  - Pyrolyse Oven Casing: `gregtech:gt.blockcasingsNH` meta 2, texture `MACHINE_ULV_SIDE`.
  - Steel Pipe Casing: `gregtech:gt.blockcasings2` meta 13, texture `MACHINE_CASING_PIPE_STEEL`.
  - Steel Firebox Casing: `gregtech:gt.blockcasings3` meta 14, sides `MACHINE_CASING_FIREBOX_STEEL`, top and bottom `MACHINE_CASING_FIREBOX_STEEL_TOP`.
  - Steel Frame Box: `gregtech:gt.blockframes` meta 305, texture `blocks/materialicons/NONE/frameGt.png` tinted `#808080`.
  - Kanthal coil: the existing `coil_kanthal`.
- The controller for 15546 wears `MACHINE_ULV_SIDE` with `OVERLAY_FRONT_PYROLYSE_OVEN`.
- Planner coordinates: x 0–6 left to right seen from the front, y 0–5 bottom to top, z 4 the front row. GT shape strings map as x = a, y = 5 − b, z = 4 − c.
- GT needs at least 60 Pyrolyse Oven Casings (`MTEPyrolyseOven.checkMachine`), so 73 casing-or-hatch cells allow 13 hatches at most.
- Textures, recipe data and icons from the user's game are never committed. Tests use made-up recipes only, and `public/` stays untouched.
- Plan notes have no trailing full stop. Structure notes (`Structure.notes` in `multiblock.ts`) keep one, like the existing ones.
- Match the surrounding code's style: comment density, terse helpers, and the GT source cited in doc comments for rules taken from GT.

## Review Focus

1. **Transcribing GT's shape wrong** (a mirrored row, an off-by-one layer) means the oven never forms in game. Task 2 checks every cell against GT's own shape strings.
2. **A frame written into the schematic** would paste as the wrong material (305 & 255 = 49). Task 1 pins that frames are skipped and any meta above 255 throws.
3. **The muffler covered by routing.** The oven is 6 tall, so the cell above the muffler (`[3,3,2]`) lies inside the routable height. Task 4 pins it uncovered in a whole line.
4. **The Calculator still defaulting to 1159.** Task 3 pins that `machineOptions` drops 1159 when 15546 is on the map, and keeps 1159 when it's alone.
5. **Too many fluids** must fall back to a note, never to a missing energy hatch or fewer than 60 casings. Task 2 pins it.

---

### Task 1: Catalog blocks, controller, frame drawing and the schematic writer

**Files:**
- Modify: `src/catalog/types.ts` (`CatalogEntry`), `src/catalog/entries.ts` (`CASINGS`, `CONTROLLERS`), `src/editor/scene/materials.ts` (`machineMaterials`), `src/export/schematic.ts`
- Test: `src/catalog/catalog.test.ts`, `src/export/schematic.test.ts`

**Interfaces:**
- Produces:
  - Catalog keys `casing_pyrolyse`, `casing_steel_pipe`, `casing_steel_firebox`, `frame_steel`.
  - Controller `gt_15546` through `generatedEntry` with `multiblock: true`.
- New optional `CatalogEntry` fields:
  - `tint?: boolean`: textured faces are drawn in `color` instead of white.
  - `notInSchematic?: boolean`: shown in 3D, never written to a schematic.

- [ ] **Step 1: Write the failing tests**

In `catalog.test.ts`:

```ts
it('has the Pyrolyse Oven blocks', () => {
  expect(CATALOG.get('casing_pyrolyse')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasingsNH', meta: 2, textures: { side: 'blocks/iconsets/MACHINE_ULV_SIDE.png' } });
  expect(CATALOG.get('casing_steel_pipe')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasings2', meta: 13, textures: { side: 'blocks/iconsets/MACHINE_CASING_PIPE_STEEL.png' } });
  expect(CATALOG.get('casing_steel_firebox')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockcasings3', meta: 14, textures: {
    top: 'blocks/iconsets/MACHINE_CASING_FIREBOX_STEEL_TOP.png', bottom: 'blocks/iconsets/MACHINE_CASING_FIREBOX_STEEL_TOP.png', side: 'blocks/iconsets/MACHINE_CASING_FIREBOX_STEEL.png' } });
  expect(CATALOG.get('frame_steel')).toMatchObject({ kind: 'casing', vanilla: 'gregtech:gt.blockframes', meta: 305, color: '#808080', seeThrough: true, tint: true, notInSchematic: true,
    textures: { side: 'blocks/materialicons/NONE/frameGt.png' } });
});

it('the Pyrolyse Oven controller wears its casing and front overlay', () => {
  const e = generatedEntry({ key: 'gt_15546', name: 'Pyrolyse Oven', mID: 15546, multiblock: true });
  expect(e).toMatchObject({ meta: 2, textures: { side: 'blocks/iconsets/MACHINE_ULV_SIDE.png', front: 'blocks/iconsets/OVERLAY_FRONT_PYROLYSE_OVEN.png' } });
});
```

In `schematic.test.ts` (use the file's existing `mk`, `v` and `num` helpers, and `buildSchematicTag` the way the other tests do):

```ts
test('frame boxes stay out of the schematic; the bounds come from the rest', () => {
  // A casing at the origin and a Steel Frame Box above it: only the casing is written, and the schematic is 1 tall.
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'casing_steel_pipe' }, { pos: [0, 1, 0], key: 'frame_steel' }]));
  expect(num(tag, 'Height')).toBe(1);
  expect([...(v(tag, 'Data') as { value: Uint8Array }).value]).toEqual([13]);
});

test('a block with metadata above 255 is refused, not truncated', () => {
  const catalog = new Map(CATALOG);
  catalog.set('wide_meta', { ...CATALOG.get('casing_steel_pipe')!, key: 'wide_meta', name: 'Wide', meta: 305 });
  expect(() => buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'wide_meta' }]), catalog)).toThrow(/Wide.*305.*0-255/);
});
```

Adapt the `buildSchematicTag` call and return shape to its real signature. If it takes no catalog argument, pass one the way `buildSchematic` gets it. Keep the assertions as written.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/catalog src/export/schematic.test.ts`
Expected: FAIL. The new keys are missing, the frame is written, and meta 305 is written as 49.

- [ ] **Step 3: Implement the changes**

- **Catalog types:** add `tint` and `notInSchematic` to `CatalogEntry`, each with a one-line doc comment.
- **Catalog entries:**
  - Add the four entries to `CASINGS`.
  - The firebox needs separate top/bottom and side textures. Give `casingBlock` an optional top/bottom texture, or add a sibling helper.
  - Add `15546: { casing: 'MACHINE_ULV_SIDE', overlay: 'OVERLAY_FRONT_PYROLYSE_OVEN' }` to `CONTROLLERS`.
- **Drawing (`machineMaterials`):** a textured face uses `entry.tint ? entry.color : '#ffffff'`.
- **Schematic writer (`schematic.ts`):**
  - When resolving cells, drop entries with `notInSchematic` before the bounds are computed. Don't add a warning; the line note covers it.
  - Throw `Error(\`${entry.name} has block metadata ${entry.meta}; a schematic holds 0-255\`)` for any written cell whose `entry.meta > 255`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run` and `npx tsc -b`, then delete `tsconfig.tsbuildinfo`.
Expected: all pass, and tsc is clean.

- [ ] **Step 5: Commit**

```bash
git add src/catalog src/editor/scene/materials.ts src/export
git commit -m "feat(catalog): Pyrolyse Oven casings, steel frame (3D only) and controller; schematic refuses meta above 255"
```

---

### Task 2: The Pyrolyse Oven structure

**Files:**
- Modify: `src/layout/multiblock.ts`
- Test: `src/layout/multiblock.test.ts`, and add 15546 to the shared structure table test if one lists every definition

**Interfaces:**
- Consumes the Task 1 catalog keys.
- Produces:
  - `export const PYROLYSE_OVEN_ID = 15546`.
  - `export function hasMuffler(mID: number): boolean`, true for `EBF_ID` and `PYROLYSE_OVEN_ID`.
  - `DEFINITIONS[15546] = pyrolyseOven`. `buildable(15546, tier)` is true up to HV, and `buildable(1159, tier)` is false.

- [ ] **Step 1: Write the failing tests** (new `describe('pyrolyse oven', ...)` in `multiblock.test.ts`, using its `mb`, `at` and `countKey` helpers)

```ts
// MTEPyrolyseOven's shape, verbatim: [c][b], c 0 = front, b 0 = top; char a = x.
const GT_SHAPE = [
  ['       ', '       ', ' F   F ', 'FBF FBF', 'DBD~DBD', 'GGGGGGG'],
  ['       ', '       ', ' C   C ', 'F FFF F', 'D D D D', 'GCGGGCG'],
  ['       ', '       ', ' C   C ', 'F FFF F', 'D     D', 'GCGGGCG'],
  ['       ', '       ', ' C   C ', 'F FFF F', 'D D D D', 'GCGGGCG'],
  [' E   E ', ' A   A ', ' A   A ', 'FAF FAF', 'DADDDAD', 'GGGGGGG'],
];
const oven = (over: Partial<PlanMachine> = {}) =>
  structureFor(mb(15546, { tier: 'MV', inputs: ['item:log', 'fluid:nitrogen'], outputs: ['item:charcoal', 'fluid:creosote'], ...over }))!;

it("matches GT's shape cell for cell", () => {
  const s = oven();
  expect(s.size).toEqual([7, 6, 5]);
  const BLOCK: Record<string, string> = { C: 'coil_kanthal', A: 'casing_steel_pipe', B: 'casing_steel_firebox', E: 'frame_steel', D: 'casing_pyrolyse', '~': 'gt_15546' };
  GT_SHAPE.forEach((rows, c) => rows.forEach((row, b) => [...row].forEach((ch, a) => {
    const [x, y, z] = [a, 5 - b, 4 - c];
    const block = at(s, x, y, z)?.key;
    const port = s.ports.find((p) => p.rel[0] === x && p.rel[1] === y && p.rel[2] === z);
    if (ch === ' ') expect([block, port], `${x},${y},${z}`).toEqual([undefined, undefined]);
    else if (ch === 'F') expect(block === 'casing_pyrolyse' || ['in', 'muffler'].includes(port?.kind ?? ''), `${x},${y},${z}`).toBe(true);
    else if (ch === 'G') expect(block === 'casing_pyrolyse' || ['out', 'energy', 'maintenance'].includes(port?.kind ?? ''), `${x},${y},${z}`).toBe(true);
    else expect(block, `${x},${y},${z}`).toBe(BLOCK[ch]);
  })));
  expect(countKey(s, 'casing_pyrolyse') + s.ports.length).toBe(73);
});

it('hatches: energy front right, maintenance back, muffler on top facing up, inputs left, outputs right', () => {
  const s = oven();
  const port = (kind: string, key?: string) => s.ports.find((p) => p.kind === kind && (!key || p.key === key));
  expect(port('energy')).toMatchObject({ rel: [5, 0, 4], facing: 3, key: 'hatch_energy_mv' });
  expect(port('maintenance')).toMatchObject({ rel: [3, 0, 0], facing: 2 });
  expect(port('muffler')).toMatchObject({ rel: [3, 2, 2], facing: 1, key: 'hatch_muffler_lv', keys: [] });
  expect(at(s, 3, 3, 2)).toBeUndefined();
  expect(port('in', 'bus_input_lv')).toMatchObject({ rel: [0, 2, 2], facing: 4, keys: ['item:log'] });
  expect(port('in', 'hatch_input_lv')).toMatchObject({ rel: [0, 2, 3], facing: 4, keys: ['fluid:nitrogen'] });
  expect(port('out', 'bus_output_lv')).toMatchObject({ rel: [6, 0, 2], facing: 5, keys: ['item:charcoal'] });
  expect(port('out', 'hatch_output_lv')).toMatchObject({ rel: [6, 0, 3], facing: 5, keys: ['fluid:creosote'] });
});

it('too many fluids: the extras get a note; casings stay at 60 or more, and the energy hatch stays', () => {
  const s = oven({ inputs: ['item:log', 'fluid:a', 'fluid:b', 'fluid:c'], outputs: ['fluid:x', 'fluid:y', 'fluid:z'] });
  expect(s.ports.filter((p) => p.kind === 'in' && p.key === 'hatch_input_lv').map((p) => p.rel)).toEqual([[0, 2, 3], [0, 2, 1]]);
  expect(s.ports.filter((p) => p.kind === 'out').map((p) => p.rel)).toEqual([[6, 0, 3], [6, 0, 1]]);
  expect(s.notes).toEqual(["1 fluid inputs don't fit on the oven's left side.", "1 fluid outputs don't fit on the oven's right side."]);
  expect(countKey(s, 'casing_pyrolyse')).toBeGreaterThanOrEqual(60);
  expect(s.ports.some((p) => p.kind === 'energy')).toBe(true);
});

it('only the new oven has a structure, up to HV', () => {
  expect(buildable(15546, 'HV')).toBe(true);
  expect(buildable(15546, 'EV')).toBe(false);
  expect(buildable(1159, 'MV')).toBe(false);
  expect(hasMuffler(15546)).toBe(true);
  expect(hasMuffler(1000)).toBe(true);
  expect(hasMuffler(1002)).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/layout/multiblock.test.ts`
Expected: FAIL. `structureFor` returns undefined for 15546, and `hasMuffler` and `PYROLYSE_OVEN_ID` don't exist.

- [ ] **Step 3: Implement `pyrolyseOven(pm: PlanMachine, tier: string): Structure` in `multiblock.ts`**

- The doc comment cites `MTEPyrolyseOven`:
  - The shape and the 60-casing minimum.
  - Why Kanthal: GT's speed multiplier is `2 / (1 + coil tier)` and Kanthal is tier 1, so the oven runs at the recipe's own speed.
  - That the frames can't go in a schematic.
- Fill the cells from the spec's layer table. A direct transcription of GT's strings with the x/y/z mapping is fine. Then place the ports at the spec's spots: energy through `b.energy`, item and fluid hatches through `hatchesFor`.
- Fluid inputs fill `[0,2,3]`, then `[0,2,1]`. Fluid outputs fill `[6,0,3]`, then `[6,0,1]`. Overflow pushes the notes shown in the test.
- Add `PYROLYSE_OVEN_ID` and `hasMuffler`, and register 15546 in `DEFINITIONS`. `lockOutputs` already applies to every definition except the tower.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run` and `npx tsc -b`, then delete `tsconfig.tsbuildinfo`.
Expected: all pass, and tsc is clean.

- [ ] **Step 5: Commit**

```bash
git add src/layout/multiblock.ts src/layout/multiblock.test.ts
git commit -m "feat(layout): Pyrolyse Oven structure with Kanthal coils and a muffler on top"
```

---

### Task 3: Line notes and the Calculator's default oven

**Files:**
- Modify: `src/layout/plan.ts` (`multiblockNotes`), `src/calc/machines.ts` (`machineOptions`)
- Test: `src/layout/plan.test.ts`, `src/calc/machines.test.ts`

**Interfaces:**
- Consumes `PYROLYSE_OVEN_ID` and `hasMuffler` from Task 2.
- `machineOptions(recipe, db)` keeps its signature. It drops any machine whose replacement is also on the recipe's map; the table is `{ 1159: 15546 }`, commented with the GT conversion recipe it comes from.

- [ ] **Step 1: Write the failing tests**

In `plan.test.ts`, using the existing `towerPlan` and `inPlan` helpers. The fixture machine is named "Distillation Tower", as the EBF tests already accept.

```ts
test('a Pyrolyse Oven is planned as itself; the notes name its Kanthal coils, its muffler and its frames', async () => {
  const p = await towerPlan(15546, null, 'modular', 120);
  expect(inPlan(p).key).toBe('gt_15546');
  expect(p.notes).toContain("The Distillation Tower uses Kanthal Heating Coils so it runs at the recipe's speed (Cupronickel would halve it)");
  expect(p.notes).toContain("Keep the block above the Distillation Tower's muffler hatch empty");
  expect(p.notes).toContain("Place a Steel Frame Box on top of each of the Distillation Tower's two back pipe columns (Schematica can't hold frame boxes)");
});

test('the legacy Pyrolyse Oven keeps the stand-in', async () => {
  const p = await towerPlan(1159, null, 'modular', 120);
  expect(inPlan(p).key).toBe('marker_multiblock');
  expect(p.notes).toContain("Build the Distillation Tower here yourself (multiblocks aren't laid out yet)");
});
```

The existing EBF plan test must still pass unchanged; it checks the EBF coil and muffler notes.

In `machines.test.ts`, build a small `RecipeDb` from `oilBerryData()` with an extra map holding one recipe. The machines are `[{ mID: 1159, name: 'Pyrolyse Oven', multiblock: true }, { mID: 15546, name: 'Pyrolyse Oven', multiblock: true }]`, and a second map has only 1159.

```ts
test('machineOptions leaves out the legacy Pyrolyse Oven when the new one is on the map', () => {
  expect(machineOptions(pyroRecipe, pyroDb).map((m) => m.mID)).toEqual([15546]);
  expect(defaultMachine(pyroRecipe, pyroDb)?.mID).toBe(15546);
  expect(machineOptions(legacyOnlyRecipe, pyroDb).map((m) => m.mID)).toEqual([1159]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/layout/plan.test.ts src/calc/machines.test.ts`
Expected: FAIL. The notes are missing, and the options include 1159.

- [ ] **Step 3: Implement**

- **`plan.ts`:**
  - The muffler note goes on every planned multiblock with `hasMuffler(i.ref.mID)`, after its coil note. The EBF keeps its coil note text.
  - For `PYROLYSE_OVEN_ID`, add the Kanthal note and then the frame note, with the exact texts from the test.
- **`machines.ts`:** filter before sorting.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run` and `npx tsc -b`, then delete `tsconfig.tsbuildinfo`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/plan.ts src/layout/plan.test.ts src/calc/machines.ts src/calc/machines.test.ts
git commit -m "feat: Pyrolyse Oven line notes; the Calculator offers the craftable oven, not the legacy one"
```

---

### Task 4: A whole line with a Pyrolyse Oven

**Files:**
- Test: `src/layout/multiblockLayout.test.ts`. Modify `src/layout/tidy.ts` only if this test shows a layout bug.

**Interfaces:**
- Consumes everything above, plus `buildLine` and `checkLine` and the file's `multi`, `plan`, `item`, `fluid`, `marker` and `mufflerUncovered` helpers.

- [ ] **Step 1: Write the test**

```ts
const pyro = (o: Partial<PlanMachine> = {}) =>
  multi('pyro', 15546, 'Pyrolyse Oven', { inputs: ['item:log', 'fluid:nitrogen'], outputs: ['item:charcoal', 'fluid:creosote'], ...o });

test('a Pyrolyse Oven line builds, checks clean, keeps its muffler open and shows its frames', () => {
  const p = plan([pyro()], [
    item('item:log', ['in:log'], ['pyro']), fluid('fluid:nitrogen', ['in:n'], ['pyro']),
    item('item:charcoal', ['pyro'], ['out:charcoal']), fluid('fluid:creosote', ['pyro'], ['out:creosote']),
  ], [
    marker('out:oil', 'fluid:oil', 'out'), marker('in:log', 'item:log', 'in', 'item'), marker('in:n', 'fluid:nitrogen', 'in'),
    marker('out:charcoal', 'item:charcoal', 'out', 'item'), marker('out:creosote', 'fluid:creosote', 'out'),
  ]);
  const b = buildLine(p, 'pyro');
  expect(checkLine(b.build, p)).toEqual([]);
  mufflerUncovered(b.build);
  expect(b.build.blocks.filter((x) => x.key === 'frame_steel')).toHaveLength(2);
  expect(b.build.blocks.filter((x) => x.key === 'coil_kanthal')).toHaveLength(12);
});
```

Match the helpers' real signatures. The networks and markers above follow the EBF test in this file.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/layout/multiblockLayout.test.ts`
Expected: PASS. If it fails, debug the layout (systematic-debugging): the oven is the first 7-wide, 6-tall structure with a port two blocks up on a side. Fix the cause in `tidy.ts`, add a test for it, and run the full suite.

- [ ] **Step 3: Full verification**

Run: `npx vitest run`, `npx tsc -b` (then delete `tsconfig.tsbuildinfo`) and `npx playwright test`.
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/layout
git commit -m "test(layout): a whole line with a Pyrolyse Oven"
```
