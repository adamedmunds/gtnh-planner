import { importDump } from './importDump';

const OIL_BERRY = { id: 'gregtech:gt.metaitem.01', meta: 11342, name: 'Oil Berry' };
const CIRCUIT = { id: 'gregtech:gt.integrated_circuit', meta: 1, name: 'Programmed Circuit' };
const LF_CELL = { id: 'gregtech:gt.metaitem.98', meta: 5, name: 'Light Fuel Cell' };
const NUGGET = { id: 'gregtech:gt.metaitem.01', meta: 9032, name: 'Tin Nugget' };

function dump(overrides: Record<string, unknown> = {}) {
  return {
    format: 2,
    gregtech: '5.09.54.183',
    exportedAt: 1,
    recipeMaps: [
      { id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor', amperage: 1 },
      { id: 'gt.recipe.dieselgeneratorfuel', name: 'Combustion Generator Fuels', amperage: 1 },
    ],
    machines: [
      { mID: 511, name: 'Basic Fluid Extractor', tier: 1, voltage: 32, multiblock: false, maps: [0] },
      {
        mID: 1110, name: 'Basic Combustion Generator', tier: 1, voltage: 32, multiblock: false, maps: [1],
        generator: { efficiency: 95, euOut: 32, ampsOut: 1 },
      },
    ],
    recipes: [
      { m: 0, eut: 30, dur: 20, ii: [[0, 1], [1, 0]], fo: [[0, 100]], io: [[3, 1, 2500]] },
      { m: 1, eut: 0, dur: 0, sv: 305, ii: [[2, 1]] },
    ],
    containers: [[2, 1, 1000]],
    items: [OIL_BERRY, CIRCUIT, LF_CELL, NUGGET],
    fluids: [{ id: 'oil', name: 'Oil' }, { id: 'lightfuel', name: 'Light Fuel' }],
    ...overrides,
  };
}

test('maps item/fluid indices to resource keys and keeps names', () => {
  const { data } = importDump(dump());
  const r = data.recipes[0];
  expect(r.inputs[0]).toEqual({ key: 'item:gregtech:gt.metaitem.01@11342', amount: 1, consumed: true });
  expect(r.outputs).toContainEqual({ key: 'fluid:oil', amount: 100, chance: 1 });
  expect(data.resources.find((x) => x.key === 'fluid:oil')).toEqual({ key: 'fluid:oil', name: 'Oil', kind: 'fluid' });
  expect(data.resources.find((x) => x.key === 'eu')).toEqual({ key: 'eu', name: 'EU', kind: 'eu' });
});

test('count-0 item inputs are not consumed', () => {
  const { data } = importDump(dump());
  expect(data.recipes[0].inputs[1]).toEqual({ key: 'item:gregtech:gt.integrated_circuit@1', amount: 0, consumed: false });
});

test('output chance 10000 → 1 and 2500 → 0.25', () => {
  const { data } = importDump(dump());
  expect(data.recipes[0].outputs).toContainEqual({ key: 'item:gregtech:gt.metaitem.01@9032', amount: 1, chance: 0.25 });
});

test('fuel recipe via container becomes a Fuel and is not a normal recipe', () => {
  const { data } = importDump(dump());
  expect(data.fuels).toEqual([{ map: 1, key: 'fluid:lightfuel', euPerLitre: 305 }]);
  expect(data.recipes).toHaveLength(1);
  expect(data.maps[1].machines[0].generator).toEqual({ efficiency: 95, euOut: 32, ampsOut: 1 });
  expect(data.maps[0].machines[0]).toMatchObject({ mID: 511, tier: 1, voltage: 32, multiblock: false });
});

test('format-1 dump: no generator stats, fuels still found by map id', () => {
  const { data } = importDump(
    dump({
      format: 1,
      containers: undefined,
      machines: [{ mID: 1110, name: 'Basic Combustion Generator', tier: 1, multiblock: false, maps: [1] }],
      recipes: [{ m: 1, eut: 0, dur: 0, sv: 305, fi: [[1, 1000]] }],
    }),
  );
  expect(data.dumpFormat).toBe(1);
  expect(data.maps[1].machines[0].generator).toBeUndefined();
  expect(data.fuels).toEqual([{ map: 1, key: 'fluid:lightfuel', euPerLitre: 305 }]);
});

test('a recipe with an out-of-range index is skipped with a warning', () => {
  const { data, warnings } = importDump(dump({ recipes: [{ m: 0, eut: 30, dur: 20, ii: [[99, 1]] }] }));
  expect(data.recipes).toHaveLength(0);
  expect(warnings).toHaveLength(1);
});

test('rejects something that is not a dump', () => {
  expect(() => importDump({ hello: 1 })).toThrow(/not a recipe dump/i);
});

test('non-fuel recipes with zero or negative duration are skipped with a warning', () => {
  const { data, warnings } = importDump(dump({ recipes: [{ m: 0, eut: 30, dur: 0, ii: [[0, 1]], fo: [[0, 100]] }] }));
  expect(data.recipes).toHaveLength(0);
  expect(warnings[0]).toMatch(/duration/);
});
