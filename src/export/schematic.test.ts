import { registerMachines } from '../catalog';
import { buildSchematic, buildSchematicTag } from './schematic';
import { decodeNbt } from './nbtRead';
import type { CompoundTag, Tag } from './nbt';
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

test('recipe machines export with their mID; markers export as plain vanilla blocks', () => {
  registerMachines([{ key: 'gt_1112', name: 'Turbo Combustion Generator', mID: 1112, tier: 'HV' }]);
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'gt_1112', facing: 1 }, { pos: [1, 0, 0], key: 'marker_item_in' }]));
  const [te] = tes(tag);
  expect(num(te, 'mID')).toBe(1112);
  expect(tes(tag)).toHaveLength(1);
  const mapping = (v(tag, 'SchematicaMapping') as CompoundTag).value;
  expect(Object.keys(mapping)).toContain('minecraft:chest');
  const ids = Array.from((v(tag, 'Blocks') as { value: Uint8Array }).value);
  expect(ids[1]).toBe((mapping['minecraft:chest'] as { value: number }).value);
});
