import { CATALOG } from '../catalog';
import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock } from '../model/types';
import { buildLine } from './build';
import { checkLine } from './check';
import { machineUnits } from './region';
import { placeMultiblocks } from './tidy';
import type { LinePlan, PlanMachine } from './types';

// Multiblocks make the core bigger, and dense cores try many layouts.
vi.setConfig({ testTimeout: 120_000 });

const pm = (o: Partial<PlanMachine> & Pick<PlanMachine, 'nodeId' | 'key'>): PlanMachine => ({
  machine: { key: o.key, name: o.key, mID: 0, tier: o.tier }, count: 1, eut: 30, title: o.key, kept: [], inputs: [], outputs: [],
  generator: false, multiblock: false, ...o,
});
const multi = (nodeId: string, mID: number, name: string, o: Partial<PlanMachine>): PlanMachine => pm({
  nodeId, key: `gt_${mID}`, machine: { key: `gt_${mID}`, name, mID, tier: 'HV', multiblock: true }, tier: 'HV', eut: 480, avgEut: 480,
  title: name, multiblock: true, ...o,
});
/** Two HV mixers make Oil from A: the line's one repeated machine (a tidy line needs one). */
const mixers = (count = 2) => pm({
  nodeId: 'mix', key: 'gt_583', machine: { key: 'gt_583', name: 'Advanced Mixer II', mID: 583, tier: 'HV' }, tier: 'HV', count, eut: 120, avgEut: 120 * count,
  title: 'Mixer', inputs: ['fluid:a'], outputs: ['fluid:oil'],
});
const FLUIDS = ['fluid:f1', 'fluid:f2', 'fluid:f3', 'fluid:f4', 'fluid:f5'];
const tower = (o: Partial<PlanMachine> = {}) => multi('dt', 1126, 'Distillation Tower', { inputs: ['fluid:oil'], outputs: FLUIDS, fluidOutputs: FLUIDS, ...o });

const fluid = (key: string, producers: string[], consumers: string[]): LinePlan['networks'][number] =>
  ({ key, name: key.slice(6), kind: 'fluid', flow: 10, producers, consumers });
const marker = (id: string, key: string, dir: 'in' | 'out', kind: 'item' | 'fluid' = 'fluid'): LinePlan['markers'][number] => ({ id, key, dir, kind });

/** A straight line on outside HV power: the mixers, then `machines`, with `networks` and `markers` on top of A and Oil. */
const plan = (machines: PlanMachine[], networks: LinePlan['networks'], markers: LinePlan['markers']): LinePlan => {
  const eut = [mixers(), ...machines].reduce((s, m) => s + m.eut * m.count, 0);
  return {
    style: 'straight', sliceCount: 0, core: [], notes: [], straight: [mixers(), ...machines],
    networks: [fluid('fluid:a', ['in:a'], ['mix']), fluid('fluid:oil', ['mix'], machines.filter((m) => m.inputs.includes('fluid:oil')).map((m) => m.nodeId)), ...networks],
    markers: [marker('in:a', 'fluid:a', 'in'), { id: 'power', key: 'eu', dir: 'in', kind: 'power' }, ...markers],
    power: { tiers: ['HV'], source: { kind: 'outside', tier: 'HV', eut }, demand: { HV: eut }, transformers: [] },
  };
};
const towerPlan = (t = tower()) => plan(
  [t],
  FLUIDS.map((k, i) => fluid(k, ['dt'], [`out:${i}`])),
  FLUIDS.map((k, i) => marker(`out:${i}`, k, 'out')),
);

/** The multiblock's own blocks: its controller, hatches and casings. */
const multiblockBlocks = (b: Build, role: string) =>
  b.blocks.filter((p) => p.role === role || (!p.role && CATALOG.get(p.key)?.kind === 'casing'));
const ports = (b: Build, kind: string) => b.blocks.filter((p) => p.port?.kind === kind);

test('a distillation tower is laid out whole, each fluid out of its own layer', () => {
  const p = towerPlan();
  const { build } = buildLine(p, 'Tower line');
  expect(checkLine(build, p)).toEqual([]);
  const mb = multiblockBlocks(build, 'dt');
  const span = (a: number) => Math.max(...mb.map((b) => b.pos[a])) - Math.min(...mb.map((b) => b.pos[a])) + 1;
  expect([span(0), span(1), span(2)]).toEqual([3, 6, 3]);
  expect(mb.length).toBe(3 * 6 * 3 - 4); // the four middle cells of the upper layers but the top are air
  const bottom = build.blocks.find((b) => b.key === 'gt_1126')!.pos[1];
  for (let n = 1; n <= 5; n++) {
    const out = ports(build, 'out').filter((b) => b.pos[1] === bottom + n);
    expect(out).toHaveLength(1);
    expect(out[0].port!.keys[0]).toBe(FLUIDS[n - 1]);
  }
});

test("two towers are both built and share each layer's network", () => {
  const p = towerPlan(tower({ count: 2, avgEut: 960 }));
  const { build } = buildLine(p, 'Tower line');
  expect(build.blocks.filter((b) => b.key === 'gt_1126')).toHaveLength(2);
  expect(multiblockBlocks(build, 'dt')).toHaveLength(2 * (3 * 6 * 3 - 4));
  for (const k of FLUIDS) expect(ports(build, 'out').filter((b) => b.port!.keys[0] === k)).toHaveLength(2);
  expect(checkLine(build, p)).toEqual([]);
});

test('a tower with an item output gets its item out', () => {
  const p = plan(
    [tower({ outputs: [...FLUIDS, 'item:coke'] })],
    [...FLUIDS.map((k, i) => fluid(k, ['dt'], [`out:${i}`])), { key: 'item:coke', name: 'Coke', kind: 'item', flow: 1, producers: ['dt'], consumers: ['out:coke'] }],
    [...FLUIDS.map((k, i) => marker(`out:${i}`, k, 'out')), marker('out:coke', 'item:coke', 'out', 'item')],
  );
  const { build } = buildLine(p, 'Tower line');
  expect(ports(build, 'out').some((b) => b.key === 'bus_output_lv' && b.port!.keys.includes('item:coke'))).toBe(true);
  expect(checkLine(build, p)).toEqual([]);
});

test('a large chemical reactor and an oil cracker lay out and pass the checker', () => {
  const lcr = multi('lcr', 1169, 'Large Chemical Reactor', { inputs: ['fluid:oil', 'item:dust'], outputs: ['fluid:naphtha', 'item:ash'] });
  const cracker = multi('crack', 1160, 'Oil Cracking Unit', { inputs: ['fluid:naphtha', 'fluid:hydrogen'], outputs: ['fluid:cracked'] });
  const p = plan(
    [lcr, cracker],
    [
      { key: 'item:dust', name: 'Dust', kind: 'item', flow: 1, producers: ['in:dust'], consumers: ['lcr'] },
      { key: 'item:ash', name: 'Ash', kind: 'item', flow: 1, producers: ['lcr'], consumers: ['out:ash'] },
      fluid('fluid:naphtha', ['lcr'], ['crack']),
      fluid('fluid:hydrogen', ['in:h'], ['crack']),
      fluid('fluid:cracked', ['crack'], ['out:cracked']),
    ],
    [marker('in:dust', 'item:dust', 'in', 'item'), marker('out:ash', 'item:ash', 'out', 'item'), marker('in:h', 'fluid:hydrogen', 'in'), marker('out:cracked', 'fluid:cracked', 'out')],
  );
  const { build } = buildLine(p, 'Cracking line');
  expect(build.blocks.filter((b) => b.key === 'gt_1169')).toHaveLength(1);
  expect(build.blocks.filter((b) => b.key === 'gt_1160')).toHaveLength(1);
  expect(ports(build, 'energy').map((b) => b.role).sort()).toEqual(['crack', 'lcr']);
  expect(checkLine(build, p)).toEqual([]);
});

test("the energy hatch is cabled to the line's power", () => {
  const p = towerPlan();
  const { build } = buildLine(p, 'Tower line');
  const hatch = ports(build, 'energy');
  expect(hatch).toHaveLength(1);
  expect(hatch[0].key).toBe('hatch_energy_hv');
  const at = new Map(build.blocks.map((b) => [posKey(b.pos), b]));
  const cable: PlacedBlock | undefined = at.get(posKey(addVec(hatch[0].pos, DIRS[hatch[0].facing!])));
  expect(CATALOG.get(cable?.key ?? '')?.cable?.tier).toBe('HV');
});

test('multiblocks never touch the slices', () => {
  const base = towerPlan();
  const eut = 2 * 2 * 120 + 480;
  const p: LinePlan = {
    ...base, style: 'modular', sliceCount: 2, straight: undefined, slice: [mixers(2)], core: [tower()],
    power: { ...base.power, source: { kind: 'outside', tier: 'HV', eut }, demand: { HV: eut } },
  };
  const { build } = buildLine(p, 'Tower line');
  expect(checkLine(build, p)).toEqual([]);
  const g = build.generated!;
  const coreMin = g.leftStart + g.left * g.sliceLength;
  const mb = multiblockBlocks(build, 'dt');
  expect(mb.length).toBe(3 * 6 * 3 - 4);
  for (const b of mb) expect(b.pos[0] >= coreMin && b.pos[0] <= -1).toBe(true);
});

test('a multiblock above the outside power is reported like any machine', () => {
  const base = towerPlan();
  const p: LinePlan = { ...base, power: { ...base.power, source: { kind: 'outside', tier: 'MV', eut: 720 } }, straight: [{ ...mixers(), tier: 'MV' }, tower()] };
  expect(() => buildLine(p, 'Tower line')).toThrow(/Distillation Tower needs HV power, but the line's power is MV/);
});

test("on MV generators the tower's EU/t is stepped up with the rest", () => {
  const base = towerPlan();
  const gen = pm({
    nodeId: 'gen', key: 'combustion_generator_mv', machine: { key: 'combustion_generator_mv', name: 'Advanced Combustion Generator', mID: 1111, tier: 'MV' },
    tier: 'MV', count: 7, eut: 128, avgEut: 720, title: 'Fuel generator', inputs: ['fluid:fuel'], generator: true,
  });
  const p: LinePlan = {
    ...base, straight: [...base.straight!, gen],
    networks: [...base.networks, fluid('fluid:fuel', ['in:fuel'], ['gen'])],
    markers: [...base.markers.filter((m) => m.kind !== 'power'), marker('in:fuel', 'fluid:fuel', 'in')],
    power: { tiers: ['HV'], source: { kind: 'generators', tier: 'MV' }, demand: { HV: 720 }, transformers: [] },
  };
  const { build } = buildLine(p, 'Tower line');
  expect(checkLine(build, p)).toEqual([]);
  // 240 EU/t of mixers and 480 of tower is more than one amp of HV (512 EU/t): two step-ups.
  expect(build.blocks.filter((b) => b.stepUp)).toHaveLength(2);
});

test('a tower on its own, fed from a marker, is laid out whole', () => {
  const p: LinePlan = {
    ...towerPlan(), straight: [tower()],
    networks: [fluid('fluid:oil', ['in:oil'], ['dt']), ...FLUIDS.map((k, i) => fluid(k, ['dt'], [`out:${i}`]))],
    markers: [marker('in:oil', 'fluid:oil', 'in'), { id: 'power', key: 'eu', dir: 'in', kind: 'power' }, ...FLUIDS.map((k, i) => marker(`out:${i}`, k, 'out'))],
    power: { tiers: ['HV'], source: { kind: 'outside', tier: 'HV', eut: 480 }, demand: { HV: 480 }, transformers: [] },
  };
  const { build } = buildLine(p, 'Tower line');
  expect(multiblockBlocks(build, 'dt')).toHaveLength(3 * 6 * 3 - 4);
  expect(checkLine(build, p)).toEqual([]);
});

test('side by side, multiblocks whose side hatches face each other get a two-wide gap', () => {
  const t = tower({ count: 2, inputs: ['fluid:oil', 'item:dust'], outputs: [...FLUIDS, 'item:coke'] });
  const taken = new Set<string>();
  const { placed, width } = placeMultiblocks(machineUnits([t]), 0, taken);
  const xs = (i: number) => placed.filter((u) => u.key === 'gt_1126')[i].pos[0];
  expect([xs(0), xs(1)]).toEqual([2, 7]); // controllers in the middle column: towers at x 1..3 and 6..8
  expect(width).toBe(10);
  // Every port's cell is kept for its pipe, and none is shared.
  const cells = placed.filter((u) => u.port).map((u) => posKey(addVec(u.pos, DIRS[u.facing!])));
  expect(new Set(cells).size).toBe(cells.length);
  for (const c of cells) expect(taken.has(c)).toBe(true);
});
