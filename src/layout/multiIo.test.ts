import { buildLine } from './build';
import { checkLine } from './check';
import { DENSE_NOTE, UNTIDY_NOTE } from './tidy';
import type { LinePlan, PlanMachine } from './types';

/**
 * The Iron III Chloride line (a player's, with made-up keys): machines with several inputs and outputs. The second
 * Chemical Reactor takes two items and a fluid and gives an item and a fluid.
 */
const K = { salt: 'item:salt', sodium: 'item:sodium', cl: 'fluid:chlorine', h: 'item:hcell', empty: 'item:empty', hcl: 'fluid:hcl', iron: 'item:iron', fecl3: 'fluid:fecl3' };
const pm = (nodeId: string, key: string, mID: number, count: number, eut: number, inputs: string[], outputs: string[]): PlanMachine => ({
  nodeId, key, machine: { key, name: key, mID, tier: 'LV' }, tier: 'LV', count, eut, avgEut: eut * count, title: key,
  kept: [], inputs, outputs, generator: false, multiblock: false,
});
const el = (n: number) => pm('el', 'electrolyzer_lv', 371, n, 30, [K.salt], [K.sodium, K.cl]);
const cr1 = (n: number) => pm('cr1', 'chemical_reactor_lv', 421, n, 7, [K.h, K.cl], [K.empty, K.hcl]);
const cr2 = (n: number) => pm('cr2', 'chemical_reactor_lv', 421, n, 30, [K.iron, K.empty, K.hcl], [K.h, K.fecl3]);
const networks: LinePlan['networks'] = [
  { key: K.salt, name: 'Salt', kind: 'item', flow: 1, producers: ['in:salt'], consumers: ['el'] },
  { key: K.sodium, name: 'Sodium Dust', kind: 'item', flow: 0.5, producers: ['el'], consumers: ['out:sodium'] },
  { key: K.cl, name: 'Chlorine', kind: 'fluid', flow: 500, producers: ['el'], consumers: ['cr1'] },
  { key: K.h, name: 'Hydrogen Cell', kind: 'item', flow: 0.5, producers: ['cr2'], consumers: ['cr1'] },
  { key: K.empty, name: 'Empty Cell', kind: 'item', flow: 0.5, producers: ['cr1'], consumers: ['cr2'] },
  { key: K.hcl, name: 'Hydrochloric Acid', kind: 'fluid', flow: 500, producers: ['cr1'], consumers: ['cr2'] },
  { key: K.iron, name: 'Iron Dust', kind: 'item', flow: 0.17, producers: ['in:iron'], consumers: ['cr2'] },
  { key: K.fecl3, name: 'Iron III Chloride', kind: 'fluid', flow: 167, producers: ['cr2'], consumers: ['out:fecl3'] },
];
const markers: LinePlan['markers'] = [
  { id: 'in:salt', key: K.salt, dir: 'in', kind: 'item' },
  { id: 'in:iron', key: K.iron, dir: 'in', kind: 'item' },
  { id: 'out:sodium', key: K.sodium, dir: 'out', kind: 'item' },
  { id: 'out:fecl3', key: K.fecl3, dir: 'out', kind: 'fluid' },
  { id: 'power', key: 'eu', dir: 'in', kind: 'power' },
];
const base = {
  networks, markers, notes: [],
  power: { tiers: ['LV'], source: { kind: 'outside', tier: 'LV', eut: 350 }, demand: { LV: 350 }, transformers: [] },
} satisfies Partial<LinePlan>;

test('the Iron III Chloride line lays out as modular slices and passes the checker', () => {
  const plan: LinePlan = { ...base, style: 'modular', sliceCount: 4, slice: [el(2), cr2(1)], core: [cr1(2)] } as LinePlan;
  const { build } = buildLine(plan, 'Iron III Chloride line');
  expect(checkLine(build, plan)).toEqual([]);
  expect(build.notes).not.toContain(UNTIDY_NOTE);
  // The first reactor's output pipe also carries Iron Dust, which a Chemical Reactor takes in another recipe.
  expect(build.notes?.join(' ')).toMatch(/input from output side.*chemical_reactor_lv/);
  expect(build.notes).toContain(DENSE_NOTE);
});

test('the Iron III Chloride line lays out straight and passes the checker', () => {
  const plan: LinePlan = { ...base, style: 'straight', sliceCount: 0, core: [], straight: [el(8), cr1(2), cr2(4)] } as LinePlan;
  const { build } = buildLine(plan, 'Iron III Chloride line');
  expect(checkLine(build, plan)).toEqual([]);
});
