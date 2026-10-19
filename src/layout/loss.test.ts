import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { billOfMaterials } from '../model/editing';
import type { Build, PlacedBlock } from '../model/types';
import { buildLine } from './build';
import { checkLine } from './check';
import { cableLoss } from './loss';
import { planLine } from './plan';
import type { LinePlan } from './types';

const machinePlan = (eut: number): LinePlan => ({
  style: 'straight', sliceCount: 0, core: [],
  straight: [{ nodeId: 'fe', key: 'fluid_extractor_lv', machine: { key: 'fluid_extractor_lv', name: 'x', mID: 511, tier: 'LV' }, tier: 'LV', count: 1, eut, title: 'Fluid Extractor', kept: [], inputs: [], outputs: [], generator: false, multiblock: false }],
  networks: [], markers: [{ id: 'power', key: 'eu', dir: 'in', kind: 'power' }],
  power: { tiers: ['LV'], source: { kind: 'outside', tier: 'LV', eut }, demand: { LV: eut }, transformers: [] },
  notes: [],
});

test('a 10-block LV tin run to a 30 EU/t machine loses 10 EU/t', () => {
  const run: PlacedBlock[] = Array.from({ length: 10 }, (_, i) => ({
    pos: [i + 1, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: (1 << 4) | (1 << 5), forcedOff: 63 & ~((1 << 4) | (1 << 5)) },
  }));
  const build: Build = {
    version: 1, name: 't',
    blocks: [{ pos: [0, 0, 0], key: 'marker_power_in', role: 'power' }, ...run, { pos: [11, 0, 0], key: 'fluid_extractor_lv', facing: 1, role: 'fe' }],
  };
  expect(cableLoss(build, machinePlan(30)).total).toBe(10);
});

describe('the oil line', () => {
  let plan: LinePlan;
  beforeAll(async () => {
    const chain = reference();
    plan = planLine(chain, db, await solveForScreen(chain, db, await createHighsSolver()), 'modular') as LinePlan;
  });

  test('reports its cable loss in the notes', () => {
    const { build } = buildLine(plan, 'Light Fuel line');
    expect(build.notes?.join(' ')).toMatch(/Cables lose about \d+ EU\/t/);
  });

  test("generators that can't cover the machines plus cable loss get company", () => {
    const tight: LinePlan = { ...plan, power: { ...plan.power, demand: { ...plan.power.demand, LV: (plan.power.demand.LV ?? 0) + 160 } } };
    const { build } = buildLine(tight, 'Light Fuel line');
    const gens = billOfMaterials(build.blocks).find((l) => l.key === 'combustion_generator_mv')!.count;
    expect(gens).toBeGreaterThan(6);
    expect(checkLine(build, tight)).toEqual([]);
    expect(build.notes?.join(' ')).toMatch(/extra generator/);
  });
});
