import { buildLine } from './build';
import { checkLine } from './check';
import { DENSE_NOTE, UNTIDY_NOTE } from './tidy';
import type { LinePlan, PlanMachine } from './types';

// Dense lines try many layouts before one fits.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The Iron III Chloride line (a player's, with made-up keys): machines with several inputs and outputs. The second
 * Chemical Reactor takes two items and a fluid and gives an item and a fluid.
 */
const K = { salt: 'item:salt', sodium: 'item:sodium', cl: 'fluid:chlorine', h: 'item:hcell', empty: 'item:empty', hcl: 'fluid:hcl', iron: 'item:iron', fecl3: 'fluid:fecl3' };
const pm = (nodeId: string, key: string, mID: number, count: number, eut: number, avgEut: number, inputs: string[], outputs: string[]): PlanMachine => ({
  nodeId, key, machine: { key, name: key, mID, tier: 'LV' }, tier: 'LV', count, eut, avgEut, title: key,
  kept: [], inputs, outputs, generator: false, multiblock: false,
});
// Average EU/t of each whole group, as the Calculator solves it for 1 Iron Dust/s.
const el = (n: number) => pm('el', 'electrolyzer_lv', 371, n, 30, 240, [K.salt], [K.sodium, K.cl]);
const cr1 = (n: number) => pm('cr1', 'chemical_reactor_lv', 421, n, 7, 10.5, [K.h, K.cl], [K.empty, K.hcl]);
const cr2 = (n: number) => pm('cr2', 'chemical_reactor_lv', 421, n, 30, 100, [K.iron, K.empty, K.hcl], [K.h, K.fecl3]);
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
  // Power comes in from outside: the feed carries the whole line, a slice's layer only its own three machines.
  const layer = build.generated!.template.filter((b) => b.net?.startsWith('p:') && b.pos[1] === 1 && (b.pos[2] === 0 || b.pos[2] === 1));
  expect(layer.length).toBeGreaterThan(0);
  expect([...new Set(layer.map((b) => b.key))]).toEqual(['tin_cable_4x']);
});

test('the Iron III Chloride line lays out straight and passes the checker', () => {
  const plan: LinePlan = { ...base, style: 'straight', sliceCount: 0, core: [], straight: [el(8), cr1(2), cr2(4)] } as LinePlan;
  const { build } = buildLine(plan, 'Iron III Chloride line');
  expect(checkLine(build, plan)).toEqual([]);
});

test('with LV generators burning Light Fuel from outside, every machine gets power', () => {
  const gen: PlanMachine = {
    nodeId: 'gen', key: 'gt_1110', machine: { key: 'gt_1110', name: 'Basic Combustion Generator', mID: 1110, tier: 'LV' }, tier: 'LV',
    count: 3, eut: 32, avgEut: 350, title: 'Light Fuel generator', kept: [], inputs: ['fluid:lf'], outputs: [], generator: true, multiblock: false,
  };
  const plan: LinePlan = {
    ...base, style: 'modular', sliceCount: 4, slice: [el(2), cr2(1), gen], core: [cr1(2)],
    networks: [...networks, { key: 'fluid:lf', name: 'Light Fuel', kind: 'fluid', flow: 24, producers: ['in:lf'], consumers: ['gen'] }],
    markers: [...markers.filter((m) => m.kind !== 'power'), { id: 'in:lf', key: 'fluid:lf', dir: 'in', kind: 'fluid' }],
    power: { tiers: ['LV'], source: { kind: 'generators', tier: 'LV' }, demand: { LV: 350 }, transformers: [] },
  } as LinePlan;
  const { build } = buildLine(plan, 'Iron III Chloride line');
  expect(checkLine(build, plan)).toEqual([]);
});
