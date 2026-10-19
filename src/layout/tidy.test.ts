import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { CATALOG } from '../catalog';
import { computeConnections } from '../model/connections';
import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock } from '../model/types';
import { billOfMaterials } from '../model/editing';
import { buildLine } from './build';
import { cableLoss } from './loss';
import { checkLine } from './check';
import { planLine } from './plan';
import { FLOOR_NOTE, UNTIDY_NOTE } from './tidy';
import type { LinePlan } from './types';

let plan: LinePlan;
let line: Build;
beforeAll(async () => {
  const p = planLine(reference(), db, await solveForScreen(reference(), db, await createHighsSolver()), 'modular');
  if ('error' in p) throw new Error(p.error);
  plan = p;
  line = buildLine(plan, 'Light Fuel line').build;
});

const isConduit = (b?: PlacedBlock) => !!b && ['cable', 'fluidPipe', 'itemPipe'].includes(CATALOG.get(b.key)!.kind);
const powerLink = (b: PlacedBlock, n: PlacedBlock) => !!b.net?.startsWith('p:') && !!n.net?.startsWith('p:') && b.pos[0] === n.pos[0];

/** Where each slice's machine columns are (outside them: service columns and the core). */
function inMachineColumns(build: Build, x: number): boolean {
  const g = build.generated!;
  const starts = [
    ...Array.from({ length: g.left }, (_, k) => g.leftStart + k * g.sliceLength),
    ...Array.from({ length: g.right }, (_, k) => g.rightStart + k * g.sliceLength),
  ];
  return starts.some((s) => x >= s && x < s + g.serviceFrom!);
}

test('the oil line is tidy: passes the checker, straight runs outside service columns and the core', () => {
  expect(checkLine(line, plan)).toEqual([]);
  expect(line.generated?.serviceFrom).toBeDefined();
  const cells = new Map(line.blocks.map((b) => [posKey(b.pos), b]));
  const masks = computeConnections(line.blocks);
  for (const b of line.blocks) {
    if (!isConduit(b) || !inMachineColumns(line, b.pos[0])) continue;
    DIRS.forEach((d, side) => {
      if (side >= 4 || !((masks.get(posKey(b.pos)) ?? 0) & (1 << side))) return;
      const n = cells.get(posKey(addVec(b.pos, d)));
      const ok = (n && !isConduit(n)) || (n && powerLink(b, n));
      expect(ok, `${b.key} at ${b.pos} connects ${side} to ${n?.key}`).toBe(true);
    });
  }
});

test('the modular oil line loses under 20% of what it uses in its cables', () => {
  const demand = Object.values(plan.power.demand).reduce((s, x) => s + (x ?? 0), 0);
  expect(cableLoss(line, plan).total).toBeLessThan(0.2 * demand);
});

test('one MV generator per 4 LV machines in a slice, each pushing straight into its transformer', () => {
  const t = line.generated!.template;
  const lv = t.filter((b) => ['fluid_extractor_lv', 'distillery_lv'].includes(b.key)).length;
  const gens = t.filter((b) => b.key.startsWith('combustion_generator'));
  expect(gens).toHaveLength(Math.ceil(lv / 4));
  const at = new Map(t.map((b) => [posKey(b.pos), b]));
  for (const g of gens) expect(at.get(posKey(addVec(g.pos, DIRS[g.facing!])))?.key).toBe('transformer_mv_lv');
});

test('no power cable is a dead end in the oil line', () => {
  const t = line.generated!.template;
  const at = new Map(t.map((b) => [posKey(b.pos), b]));
  const masks = computeConnections(t);
  for (const c of t.filter((b) => b.net?.startsWith('p:'))) {
    const links = DIRS.map((d, side) => ({ n: at.get(posKey(addVec(c.pos, d))), on: ((masks.get(posKey(c.pos)) ?? 0) >> side) & 1 }))
      .filter(({ n, on }) => n && on);
    const powersMachine = links.some(({ n }) => !isConduit(n) && !n!.key.startsWith('transformer'));
    expect(powersMachine || links.length >= 2, `dead-end cable at ${c.pos}`).toBe(true);
  }
});

test('no spare power cable: every cable that powers no machine is needed to reach one', () => {
  const t = line.generated!.template;
  const at = new Map(t.map((b) => [posKey(b.pos), b]));
  const masks = computeConnections(t);
  const isPower = (b?: PlacedBlock) => !!b && (!!b.net?.startsWith('p:') || b.key.startsWith('transformer'));
  const machinesReached = (without?: string) => {
    const seen = new Set<string>();
    const stack = t.filter((b) => b.key.startsWith('transformer')).map((b) => posKey(b.pos));
    const reached = new Set<string>();
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k) || k === without) continue;
      seen.add(k);
      const b = at.get(k)!;
      DIRS.forEach((d, side) => {
        const nk = posKey(addVec(b.pos, d));
        const n = at.get(nk);
        if (!n) return;
        const linked = b.key.startsWith('transformer') ? side !== b.facing : ((masks.get(k) ?? 0) >> side) & 1;
        if (!linked) return;
        if (isPower(n)) stack.push(nk);
        else if (!isConduit(n) && !n.key.startsWith('combustion')) reached.add(nk);
      });
    }
    return reached.size;
  };
  const all = machinesReached();
  for (const c of t.filter((b) => b.net?.startsWith('p:'))) {
    const powersMachine = DIRS.some((d) => { const n = at.get(posKey(addVec(c.pos, d))); return n && !isConduit(n) && !n.key.startsWith('transformer') && !n.key.startsWith('combustion'); });
    if (!powersMachine) expect(machinesReached(posKey(c.pos)), `spare cable at ${c.pos}`).toBeLessThan(all);
  }
});

test('the core is compact: a column for the chests, one per machine, and at most two spare', () => {
  const g = line.generated!;
  const coreMin = g.leftStart + g.left * g.sliceLength;
  const core = line.blocks.filter((b) => b.pos[0] >= coreMin && b.pos[0] < 0);
  const machines = core.filter((b) => !b.net && !b.key.startsWith('marker'));
  expect(-coreMin).toBeLessThanOrEqual(1 + machines.length + 2);
});

test('cables are sized for what they carry: 1x from the core generator, 4x from each transformer', () => {
  const kinds = (pred: (b: PlacedBlock) => boolean) => [...new Set(line.blocks.filter(pred).map((b) => b.key))];
  expect(kinds((b) => !!b.net?.startsWith('p:MV'))).toEqual(['annealed_copper_cable_1x']);
  expect(kinds((b) => !!b.net?.startsWith('p:LV'))).toEqual(['tin_cable_4x']);
});

test('the oil line fits the tidy cross-section and says what to dig', () => {
  const span = (a: number) => Math.max(...line.blocks.map((b) => b.pos[a])) - Math.min(...line.blocks.map((b) => b.pos[a])) + 1;
  expect(span(2)).toBeLessThanOrEqual(7);
  expect(span(1)).toBeLessThanOrEqual(5);
  expect(line.notes).toContain(FLOOR_NOTE);
  expect(line.notes?.join(' ')).not.toMatch(/fall short/);
});

const solved = async (style: 'modular' | 'straight') => {
  const p = planLine(reference(), db, await solveForScreen(reference(), db, await createHighsSolver()), style);
  if ('error' in p) throw new Error(p.error);
  return p;
};

/** The reference line powered from outside at HV (no generators). */
async function hvPlan(style: 'modular' | 'straight'): Promise<LinePlan> {
  const p = await solved(style);
  const gen = [...(p.slice ?? []), ...p.core, ...(p.straight ?? [])].find((m) => m.generator)!.nodeId;
  const strip = (ms?: LinePlan['core']) => ms?.filter((m) => !m.generator);
  return {
    ...p, slice: strip(p.slice), core: strip(p.core)!, straight: strip(p.straight),
    networks: p.networks.map((n) => ({ ...n, consumers: n.consumers.filter((c) => c !== gen) })),
    markers: [...p.markers, { id: 'power', key: 'eu', dir: 'in', kind: 'power' }],
    power: { ...p.power, tiers: ['LV', 'MV', 'HV'], source: { kind: 'outside', tier: 'HV', eut: 600 } },
  };
}

describe('straight lines', () => {
  let straight: LinePlan;
  let build: Build;
  beforeAll(async () => {
    straight = await solved('straight');
    build = buildLine(straight, 'Light Fuel line').build;
  });

  test('the straight oil line is tidy and loses under 30% in its cables (it was 390% before tidy routing)', () => {
    expect(checkLine(build, straight)).toEqual([]);
    const demand = Object.values(straight.power.demand).reduce((s, x) => s + (x ?? 0), 0);
    expect(cableLoss(build, straight).total).toBeLessThan(0.3 * demand);
    expect(build.notes?.join(' ')).not.toMatch(/fall short/);
    expect(build.notes).not.toContain(UNTIDY_NOTE);
  });

  test('a long LV layer is 4x: each block carries at most one transformer of 4 A', () => {
    expect([...new Set(build.blocks.filter((b) => b.net?.startsWith('p:LV')).map((b) => b.key))]).toEqual(['tin_cable_4x']);
  });

  test('transformers sit next to what they feed', () => {
    const at = new Map(build.blocks.map((b) => [posKey(b.pos), b]));
    const lv = (b?: PlacedBlock) => !!b && ['fluid_extractor_lv', 'distillery_lv', 'chemical_reactor_lv'].includes(b.key);
    for (const t of build.blocks.filter((b) => b.key === 'transformer_mv_lv')) {
      const near = DIRS.map((d) => at.get(posKey(addVec(t.pos, d))));
      const ok = near.some(lv) || near.some((n) => n && CATALOG.get(n.key)!.kind === 'cable' && DIRS.some((d) => lv(at.get(posKey(addVec(n.pos, d))))));
      expect(ok, `transformer at ${t.pos}`).toBe(true);
    }
  });
});

test('HV power from outside lays out: HV→MV in the core, MV→LV in the power runs', async () => {
  const hv = await hvPlan('modular');
  const { build } = buildLine(hv, 'Light Fuel line');
  expect(checkLine(build, hv)).toEqual([]);
  expect(build.notes).not.toContain(UNTIDY_NOTE);
  const bom = Object.fromEntries(billOfMaterials(build.blocks).map((l) => [l.key, l.count]));
  expect(bom.transformer_hv_mv).toBeGreaterThanOrEqual(1);
  const sliceTransformers = build.generated!.template.filter((b) => b.key === 'transformer_mv_lv');
  expect(sliceTransformers.length).toBeGreaterThan(0);
  for (const t of sliceTransformers) expect(t.pos[1]).toBe(1);
});
