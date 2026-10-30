import { CATALOG, registerMachines } from '../catalog';
import { buildSchematic, buildSchematicTag } from './schematic';
import { decodeNbt } from './nbtRead';
import type { CompoundTag, ListTag, Tag } from './nbt';
import type { Build, PlacedBlock } from '../model/types';

const mk = (blocks: PlacedBlock[]): Build => ({ version: 1, name: 't', blocks });
const v = (t: CompoundTag, k: string): Tag => {
  const x = t.value[k];
  if (!x) throw new Error(`missing ${k}`);
  return x;
};
const num = (t: CompoundTag, k: string) => (v(t, k) as { value: number }).value;
const tes = (t: CompoundTag) => (v(t, 'TileEntities') as { value: CompoundTag[] }).value;

test('single machine: header, mapping, block, data and tile entity', () => {
  const { tag, warnings, size } = buildSchematicTag(mk([{ pos: [5, 64, -3], key: 'distillery_lv', facing: 2 }]));
  expect(warnings).toEqual([]);
  expect(size).toEqual({ width: 1, height: 1, length: 1 });
  expect(v(tag, 'Width')).toEqual({ type: 'short', value: 1 });
  expect(v(tag, 'Height')).toEqual({ type: 'short', value: 1 });
  expect(v(tag, 'Length')).toEqual({ type: 'short', value: 1 });
  expect(v(tag, 'Materials')).toEqual({ type: 'string', value: 'Alpha' });
  expect(v(tag, 'SchematicaMapping')).toEqual({
    type: 'compound',
    value: {
      'minecraft:air': { type: 'short', value: 0 },
      'gregtech:gt.blockmachines': { type: 'short', value: 1 },
    },
  });
  expect(tag.value.AddBlocks).toBeUndefined();
  expect(Array.from((v(tag, 'Blocks') as { value: Uint8Array }).value)).toEqual([1]);
  expect(Array.from((v(tag, 'Data') as { value: Uint8Array }).value)).toEqual([1]);
  expect(v(tag, 'Entities')).toEqual({ type: 'list', elementType: 'compound', value: [] });
  const [te] = tes(tag);
  expect(te.value).toEqual({
    x: { type: 'int', value: 0 },
    y: { type: 'int', value: 0 },
    z: { type: 'int', value: 0 },
    id: { type: 'string', value: 'BaseMetaTileEntity' },
    mID: { type: 'int', value: 531 },
    mFacing: { type: 'short', value: 2 },
  });
});

test('pipes write BaseMetaPipeEntity with mConnections byte and pipe meta', () => {
  const { tag } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'bronze_pipe_normal' },
    { pos: [0, 0, 1], key: 'bronze_pipe_normal' },
  ]));
  const list = tes(tag);
  expect(list).toHaveLength(2);
  const first = list.find((t) => num(t, 'z') === 0)!;
  expect(v(first, 'id')).toEqual({ type: 'string', value: 'BaseMetaPipeEntity' });
  expect(v(first, 'mID')).toEqual({ type: 'int', value: 5122 });
  expect(v(first, 'mConnections')).toEqual({ type: 'byte', value: 1 << 3 });
  expect(first.value.mFacing).toBeUndefined();
  expect(Array.from((v(tag, 'Data') as { value: Uint8Array }).value)).toEqual([6, 6]);
});

test('asymmetric bounding box uses index x + (y * Length + z) * Width', () => {
  // Width (X) 3, Height (Y) 2, Length (Z) 4
  const { tag, size } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [2, 1, 3], key: 'distillery_lv' },
    { pos: [1, 0, 2], key: 'bronze_pipe_small' },
  ]));
  expect(size).toEqual({ width: 3, height: 2, length: 4 });
  const blocks = (v(tag, 'Blocks') as { value: Uint8Array }).value;
  const data = (v(tag, 'Data') as { value: Uint8Array }).value;
  expect(blocks.length).toBe(24);
  const idx = (x: number, y: number, z: number) => x + (y * 4 + z) * 3;
  expect(blocks[idx(0, 0, 0)]).toBe(1);
  expect(data[idx(0, 0, 0)]).toBe(9);
  expect(blocks[idx(2, 1, 3)]).toBe(1);
  expect(data[idx(2, 1, 3)]).toBe(1);
  expect(blocks[idx(1, 0, 2)]).toBe(1);
  expect(data[idx(1, 0, 2)]).toBe(6);
  expect(Array.from(blocks).filter((b) => b !== 0)).toHaveLength(3);
});

test('negative coordinates are shifted so the min corner is 0,0,0', () => {
  const { tag } = buildSchematicTag(mk([
    { pos: [-10, -2, -7], key: 'electrolyzer_lv', facing: 5 },
    { pos: [-8, -2, -7], key: 'chemical_reactor_lv', facing: 5 },
  ]));
  const coords = tes(tag).map((t) => [num(t, 'x'), num(t, 'y'), num(t, 'z')]).sort();
  expect(coords).toEqual([[0, 0, 0], [2, 0, 0]]);
  expect(num(tag, 'Width')).toBe(3);
});

test('machine without facing exports mFacing 3 (south)', () => {
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'distillery_lv' }]));
  expect(v(tes(tag)[0], 'mFacing')).toEqual({ type: 'short', value: 3 });
});

test('duplicate positions: last wins, one tile entity, warning returned', () => {
  const { tag, warnings } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'distillery_lv' },
    { pos: [0, 0, 0], key: 'electrolyzer_lv' },
  ]));
  expect(tes(tag)).toHaveLength(1);
  expect(v(tes(tag)[0], 'mID')).toEqual({ type: 'int', value: 371 });
  expect(warnings.some((w) => w.includes('0,0,0'))).toBe(true);
});

test('unknown keys are skipped with a warning; all-unknown or empty builds throw', () => {
  const { tag, warnings } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'distillery_lv' },
    { pos: [1, 0, 0], key: 'removed_thing' },
  ]));
  expect(tes(tag)).toHaveLength(1);
  expect(num(tag, 'Width')).toBe(1);
  expect(warnings.some((w) => w.includes('removed_thing'))).toBe(true);
  expect(() => buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'removed_thing' }]))).toThrow('Build is empty');
  expect(() => buildSchematicTag(mk([]))).toThrow('Build is empty');
});

test('buildSchematic gzips a root named "Schematic" that decodes to the same tag', () => {
  const build = mk([{ pos: [0, 0, 0], key: 'distillery_lv', facing: 3 }]);
  const { bytes } = buildSchematic(build);
  expect(bytes[0]).toBe(0x1f);
  expect(bytes[1]).toBe(0x8b);
  const { name, root } = decodeNbt(bytes);
  expect(name).toBe('Schematic');
  expect(root).toEqual(buildSchematicTag(build).tag);
});

test('refuses builds whose bounding box volume is too large, naming the bounds', () => {
  expect(() => buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'distillery_lv' },
    { pos: [3000, 200, 3000], key: 'distillery_lv' },
  ]))).toThrow(/too large.*0,0,0.*3000,200,3000/);
});

test('recipe machines export with their mID; glass markers export as plain glass', () => {
  registerMachines([{ key: 'gt_1112', name: 'Turbo Combustion Generator', mID: 1112, tier: 'HV' }]);
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'gt_1112', facing: 1 }, { pos: [1, 0, 0], key: 'marker_fluid_in' }]));
  const [te] = tes(tag);
  expect(num(te, 'mID')).toBe(1112);
  expect(tes(tag)).toHaveLength(1);
  const mapping = (v(tag, 'SchematicaMapping') as CompoundTag).value;
  const ids = Array.from((v(tag, 'Blocks') as { value: Uint8Array }).value);
  expect(ids[1]).toBe((mapping['minecraft:glass'] as { value: number }).value);
});

test('item markers export as oak and spruce drawers facing their front, holding what a placed one does', () => {
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'marker_item_in', facing: 4 }, { pos: [1, 0, 0], key: 'marker_item_out', facing: 5 }]));
  const mapping = (v(tag, 'SchematicaMapping') as CompoundTag).value;
  const ids = Array.from((v(tag, 'Blocks') as { value: Uint8Array }).value);
  const data = Array.from((v(tag, 'Data') as { value: Uint8Array }).value);
  const drawerId = (mapping['StorageDrawers:fullDrawers1'] as { value: number }).value;
  expect([ids[0], ids[1]]).toEqual([drawerId, drawerId]);
  expect([data[0], data[1]]).toEqual([0, 1]);
  // As a drawer in the user's world saves it: its front (Dir), capacity in stacks (GTNH config: 64) and one empty slot.
  const [oak, spruce] = tes(tag);
  expect((oak.value.id as { value: string }).value).toBe('StorageDrawers:tileDrawersStandard');
  expect(num(oak, 'Dir')).toBe(4);
  expect(num(spruce, 'Dir')).toBe(5);
  expect(num(oak, 'Cap')).toBe(64);
  expect((oak.value.Slots as ListTag).value).toHaveLength(1);
});

test('the fluid output marker exports as a GT Super Tank I with its front where the build says', () => {
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'marker_fluid_out', facing: 2 }]));
  const [te] = tes(tag);
  expect((te.value.id as { value: string }).value).toBe('BaseMetaTileEntity');
  expect(num(te, 'mID')).toBe(130);
  expect(num(te, 'mFacing')).toBe(2);
  expect(Array.from((v(tag, 'Data') as { value: Uint8Array }).value)[0]).toBe(1);
});

test('a machine with a front writes mMainFacing next to its output face', () => {
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'distillery_lv', facing: 2, mainFacing: 3 }]));
  const [te] = tes(tag);
  expect(num(te, 'mFacing')).toBe(2);
  expect(num(te, 'mMainFacing')).toBe(3);
});

test("a locked output hatch is pasted locked to its fluid (MTEHatchOutput's mMode 9, lockedFluidName)", () => {
  const locked = tes(buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'hatch_output_lv', facing: 3, port: { kind: 'out', keys: ['fluid:liquid_sufluriclight_fuel'], locked: true } },
  ])).tag)[0];
  expect(v(locked, 'mMode')).toEqual({ type: 'byte', value: 9 });
  expect(v(locked, 'lockedFluidName')).toEqual({ type: 'string', value: 'liquid_sufluriclight_fuel' });
  const open = tes(buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'hatch_output_lv', facing: 3, port: { kind: 'out', keys: ['fluid:oil'] } },
  ])).tag)[0];
  expect(open.value.mMode).toBeUndefined();
  expect(open.value.lockedFluidName).toBeUndefined();
});

test('a pasted basic machine has auto-output on, and input from its output side only where the build needs it', () => {
  const plain = tes(buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'distillery_lv', facing: 2, mainFacing: 3 }])).tag)[0];
  expect(num(plain, 'mAllowInputFromOutputSide')).toBe(0);
  expect(num(plain, 'mItemTransfer')).toBe(1);
  expect(num(plain, 'mFluidTransfer')).toBe(1);
  const needs: Build = { ...mk([{ pos: [0, 0, 0], key: 'distillery_lv', facing: 2, mainFacing: 3 }]), covers: [{ pos: [0, 0, 0], side: 2, kind: 'inputFromOutput' }] };
  expect(num(tes(buildSchematicTag(needs).tag)[0], 'mAllowInputFromOutputSide')).toBe(1);
});

test('multiblock parts export: casings as their GT block and meta, hatches as GT machines facing out', () => {
  const { tag } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'casing_clean_stainless' },
    { pos: [1, 0, 0], key: 'hatch_output_lv', facing: 3 },
  ]));
  const mapping = (v(tag, 'SchematicaMapping') as CompoundTag).value;
  expect(Object.keys(mapping)).toContain('gregtech:gt.blockcasings4');
  expect((v(tag, 'Data') as { value: Uint8Array }).value[0]).toBe(1);
  const entities = tes(tag);
  expect(entities).toHaveLength(1);
  expect(num(entities[0], 'mID')).toBe(61);
  expect(num(entities[0], 'mFacing')).toBe(3);
});

test('an LV muffler hatch exports as a GT machine facing its front, meta 1', () => {
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'hatch_muffler_lv', facing: 1 }]));
  const [te] = tes(tag);
  expect(num(te, 'mID')).toBe(91);
  expect(num(te, 'mFacing')).toBe(1);
  expect(Array.from((v(tag, 'Data') as { value: Uint8Array }).value)).toEqual([1]);
});

test('frame boxes stay out of the schematic; the bounds come from the rest', () => {
  // A casing at the origin and a Steel Frame Box above it: only the casing is written, and the schematic is 1 tall.
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'casing_steel_pipe' }, { pos: [0, 1, 0], key: 'frame_steel' }]));
  expect(num(tag, 'Height')).toBe(1);
  expect([...(v(tag, 'Data') as { value: Uint8Array }).value]).toEqual([13]);
});

test('frames left out of the schematic are named in a warning with their count', () => {
  const { warnings } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'casing_steel_pipe' }, { pos: [0, 1, 0], key: 'frame_steel' }, { pos: [0, 2, 0], key: 'frame_steel' }]));
  expect(warnings).toContain("Left out 2 × Steel Frame Box; place by hand (a schematic can't hold it)");
});

test('a build of only frames is still empty', () => {
  expect(() => buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'frame_steel' }]))).toThrow('Build is empty');
});

test('a block with metadata above 255 is refused, not truncated', () => {
  const catalog = new Map(CATALOG);
  catalog.set('wide_meta', { ...CATALOG.get('casing_steel_pipe')!, key: 'wide_meta', name: 'Wide', meta: 305 });
  expect(() => buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'wide_meta' }]), catalog)).toThrow(/Wide.*305.*0-255/);
});
