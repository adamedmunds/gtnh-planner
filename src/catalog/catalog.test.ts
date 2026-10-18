import { CATALOG, CATALOG_ENTRIES, getEntry } from './index';

test('keys and mIDs are unique', () => {
  const keys = CATALOG_ENTRIES.map((e) => e.key);
  const ids = CATALOG_ENTRIES.map((e) => e.mID);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(ids).size).toBe(ids.length);
  expect(CATALOG.size).toBe(CATALOG_ENTRIES.length);
});

test.each([
  ['fluid_extractor_lv', 511, 1, 'machine'],
  ['fluid_extractor_hv', 513, 1, 'machine'],
  ['distillery_lv', 531, 1, 'machine'],
  ['chemical_reactor_lv', 421, 1, 'machine'],
  ['electrolyzer_lv', 371, 1, 'machine'],
  ['extractor_mv', 272, 1, 'machine'],
  ['tin_cable_1x', 1246, 9, 'cable'],
  ['tin_cable_4x', 1248, 9, 'cable'],
  ['copper_cable_1x', 1366, 9, 'cable'],
  ['annealed_copper_cable_4x', 1388, 9, 'cable'],
  ['bronze_pipe_small', 5121, 6, 'fluidPipe'],
  ['bronze_pipe_normal', 5122, 6, 'fluidPipe'],
  ['steel_pipe_large', 5133, 7, 'fluidPipe'],
  ['tin_item_pipe_small', 5590, 7, 'itemPipe'],
  ['electrum_item_pipe_normal', 5612, 6, 'itemPipe'],
] as const)('%s has mID %i, meta %i, kind %s', (key, mID, meta, kind) => {
  const e = getEntry(key);
  expect(e).toBeDefined();
  expect(e!.mID).toBe(mID);
  expect(e!.meta).toBe(meta);
  expect(e!.kind).toBe(kind);
});

test('machines have tier casing + front overlay textures; conduits have thickness', () => {
  for (const e of CATALOG_ENTRIES) {
    if (e.kind === 'machine') {
      expect(e.tier).toBeDefined();
      expect(e.textures.side).toBe(`blocks/iconsets/MACHINE_${e.tier}_SIDE.png`);
      expect(e.textures.front).toMatch(/^blocks\/basicmachines\/[a-z_]+\/OVERLAY_FRONT\.png$/);
    } else {
      expect(e.thickness).toBeGreaterThan(0);
      expect(e.thickness).toBeLessThanOrEqual(1);
    }
  }
});

test('getEntry returns undefined for unknown keys', () => {
  expect(getEntry('nope')).toBeUndefined();
});
