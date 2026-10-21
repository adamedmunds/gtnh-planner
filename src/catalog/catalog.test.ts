import { CATALOG, CATALOG_ENTRIES, getEntry, machineKey, registerMachines } from './index';

test('keys and mIDs are unique', () => {
  const keys = CATALOG_ENTRIES.map((e) => e.key);
  // Markers are vanilla stand-ins with no GregTech id.
  const ids = CATALOG_ENTRIES.filter((e) => e.kind !== 'marker').map((e) => e.mID);
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
  // Every size GT makes; meta = 4 + the material's tool quality (0-3).
  ['bronze_pipe_tiny', 5120, 6, 'fluidPipe'],
  ['bronze_pipe_huge', 5124, 6, 'fluidPipe'],
  ['copper_pipe_tiny', 5110, 5, 'fluidPipe'],
  ['cast_iron_pipe_huge', 5264, 6, 'fluidPipe'],
  ['plastic_pipe_normal', 5172, 5, 'fluidPipe'],
  ['ptfe_pipe_large', 5683, 5, 'fluidPipe'],
  ['tin_item_pipe_tiny', 5589, 7, 'itemPipe'],
  ['tin_item_pipe_huge', 5593, 7, 'itemPipe'],
  ['brass_item_pipe_huge', 5604, 5, 'itemPipe'],
  ['electrum_item_pipe_large', 5613, 6, 'itemPipe'],
  ['nickel_item_pipe_normal', 5700, 6, 'itemPipe'],
  ['cobalt_item_pipe_large', 5711, 7, 'itemPipe'],
  ['aluminium_item_pipe_huge', 5722, 6, 'itemPipe'],
  ['pvc_item_pipe_normal', 5690, 5, 'itemPipe'],
  ['combustion_generator_mv', 1111, 1, 'machine'],
  ['transformer_mv_lv', 21, 1, 'machine'],
] as const)('%s has mID %i, meta %i, kind %s', (key, mID, meta, kind) => {
  const e = getEntry(key);
  expect(e).toBeDefined();
  expect(e!.mID).toBe(mID);
  expect(e!.meta).toBe(meta);
  expect(e!.kind).toBe(kind);
});

test('machines have tier casing + front overlay textures; conduits have thickness', () => {
  for (const e of CATALOG_ENTRIES) {
    if (e.kind === 'marker') continue;
    if (e.kind === 'machine') {
      expect(e.tier).toBeDefined();
      expect(e.textures.side).toBe(`blocks/iconsets/MACHINE_${e.tier}_SIDE.png`);
      expect(e.textures.front).toMatch(/^blocks\/(basicmachines\/[a-z_]+|iconsets)\/OVERLAY_[A-Z_]+\.png$/);
    } else {
      expect(e.textures.side, e.key).toBeDefined();
      expect(e.textures.end, e.key).toBeDefined();
      if (e.kind === 'cable') expect(e.textures.core).toBe('blocks/materialicons/NONE/wire.png');
      expect(e.thickness).toBeGreaterThan(0);
      expect(e.thickness).toBeLessThanOrEqual(1);
    }
  }
});

test('getEntry returns undefined for unknown keys', () => {
  expect(getEntry('nope')).toBeUndefined();
});

test('HV power parts and new pipes', () => {
  const gold = getEntry('gold_cable_4x')!;
  expect(gold).toMatchObject({ mID: 1428, kind: 'cable', cable: { tier: 'HV', ampsPerSize: 3, size: 4, lossPerBlock: 2 } });
  expect(getEntry('tin_cable_1x')!.cable).toEqual({ tier: 'LV', ampsPerSize: 1, size: 1, lossPerBlock: 1 });
  expect(getEntry('annealed_copper_cable_4x')!.cable).toEqual({ tier: 'MV', ampsPerSize: 1, size: 4, lossPerBlock: 1 });
  expect(getEntry('transformer_hv_mv')).toMatchObject({ mID: 22, kind: 'machine', tier: 'MV' });
  expect(getEntry('stainless_steel_pipe_normal')).toMatchObject({ mID: 5142, kind: 'fluidPipe' });
  expect(getEntry('titanium_pipe_large')).toMatchObject({ mID: 5153, kind: 'fluidPipe' });
  // GT fluid pipes: L/t of tiny base/6, small base/3, normal base, large 2x, huge 4x (Bronze base 120), shown per second.
  expect(getEntry('bronze_pipe_tiny')!.pipeCapacity).toBe(400);
  expect(getEntry('bronze_pipe_small')!.pipeCapacity).toBe(800);
  expect(getEntry('bronze_pipe_normal')!.pipeCapacity).toBe(2400);
  expect(getEntry('titanium_pipe_huge')!.pipeCapacity).toBe(38400);
  // GT item pipes move a few stacks per so many ticks: Tin 1 stack per 4 s (small) / 2 s, Electrum 1 / 2 stacks per s.
  expect(getEntry('tin_item_pipe_small')!.itemCapacity).toBe(16);
  expect(getEntry('tin_item_pipe_normal')!.itemCapacity).toBe(32);
  expect(getEntry('electrum_item_pipe_small')!.itemCapacity).toBe(64);
  expect(getEntry('electrum_item_pipe_normal')!.itemCapacity).toBe(128);
  expect(getEntry('tin_item_pipe_tiny')!.itemCapacity).toBe(8);
  expect(getEntry('electrum_item_pipe_huge')!.itemCapacity).toBe(512);
  expect(getEntry('nickel_item_pipe_normal')!.itemCapacity).toBe(64);
});

test('markers', () => {
  for (const k of ['marker_item_in', 'marker_item_out', 'marker_fluid_in', 'marker_fluid_out', 'marker_power_in', 'marker_multiblock']) {
    expect(getEntry(k)).toMatchObject({ kind: 'marker', group: 'Markers' });
    expect(getEntry(k)!.vanilla).toMatch(/^minecraft:/);
  }
});

test('machines from recipe data are registered under gt_<mID>', () => {
  expect(machineKey(1112)).toBe('gt_1112');
  registerMachines([{ key: 'gt_1112', name: 'Turbo Combustion Generator', mID: 1112, tier: 'HV' }]);
  expect(getEntry('gt_1112')).toMatchObject({ kind: 'machine', mID: 1112, name: 'Turbo Combustion Generator', tier: 'HV', group: 'Recipe machines' });
  expect(getEntry('gt_1112')!.textures.side).toBe('blocks/iconsets/MACHINE_HV_SIDE.png');
});

test('every cable size exists with GT ids, amps and loss', () => {
  expect(getEntry('copper_cable_8x')).toMatchObject({ mID: 1369, cable: { tier: 'MV', ampsPerSize: 1, size: 8, lossPerBlock: 2 } });
  expect(getEntry('annealed_copper_cable_16x')).toMatchObject({ mID: 1391, cable: { tier: 'MV', size: 16, lossPerBlock: 1 } });
  expect(getEntry('electrum_cable_2x')).toMatchObject({ mID: 1447, cable: { tier: 'HV', ampsPerSize: 2, size: 2, lossPerBlock: 1 } });
  expect(getEntry('silver_cable_1x')).toMatchObject({ mID: 1466, cable: { tier: 'HV', ampsPerSize: 1, lossPerBlock: 1 } });
  expect(getEntry('tin_cable_12x')).toMatchObject({ mID: 1250 });
});
