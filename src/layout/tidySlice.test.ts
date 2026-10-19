import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { CATALOG } from '../catalog';
import { computeConnections } from '../model/connections';
import { DIRS, addVec, posKey } from '../model/directions';
import type { PlacedBlock } from '../model/types';
import { K } from '../test/oilBerryDb';
import { planLine } from './plan';
import { machineUnits, planNets, powerNets } from './region';
import { arrangeRows } from './tidyRows';
import { tidySlice, type TidySlice } from './tidySlice';
import type { LinePlan } from './types';

let plan: LinePlan;
let slice: TidySlice;
beforeAll(async () => {
  const p = planLine(reference(), db, await solveForScreen(reference(), db, await createHighsSolver()), 'modular');
  if ('error' in p) throw new Error(p.error);
  plan = p;
  const nets = [...planNets(plan, []), ...powerNets(plan, machineUnits([...plan.slice!, ...plan.core]), {}, [])];
  for (const arr of arrangeRows(plan.slice!)) {
    for (const [w, powerFirst] of [[1, true], [1, false], [2, true], [2, false]] as const) {
      const r = tidySlice(arr, nets, plan, { serviceWidth: w, powerFirst, copies: plan.sliceCount });
      if (!('fail' in r)) {
        slice = r;
        return;
      }
    }
  }
  throw new Error('no tidy slice');
});

const at = (b: PlacedBlock[]) => new Map(b.map((x) => [posKey(x.pos), x]));
const isConduit = (b?: PlacedBlock) => !!b && ['cable', 'fluidPipe', 'itemPipe'].includes(CATALOG.get(b.key)!.kind);
const powerLink = (b: PlacedBlock, n: PlacedBlock) => !!b.net?.startsWith('p:') && !!n.net?.startsWith('p:') && b.pos[0] === n.pos[0];

test('oil slice is tidy: outside the service column conduits connect only along x, to what they serve, or to the feed', () => {
  const cells = at(slice.blocks);
  const masks = computeConnections(slice.blocks);
  for (const b of slice.blocks) {
    if (!isConduit(b) || b.pos[0] >= slice.serviceFrom) continue;
    DIRS.forEach((d, side) => {
      if (side >= 4 || !((masks.get(posKey(b.pos)) ?? 0) & (1 << side))) return;
      const n = cells.get(posKey(addVec(b.pos, d)));
      const ok = (n && !isConduit(n)) || (n && powerLink(b, n));
      expect(ok, `${b.key} at ${b.pos} connects ${side} to ${n?.key}`).toBe(true);
    });
  }
});

test('every slice machine touches its input run, its output run and power', () => {
  const cells = at(slice.blocks);
  const masks = computeConnections(slice.blocks);
  const touching = (m: PlacedBlock) => DIRS.map((d, side) => ({ side, n: cells.get(posKey(addVec(m.pos, d))) }))
    .filter(({ n, side }) => n && (!isConduit(n) || ((masks.get(posKey(n.pos)) ?? 0) & (1 << (side ^ 1))) !== 0));
  for (const m of slice.blocks.filter((b) => b.key === 'fluid_extractor_lv' || b.key === 'distillery_lv')) {
    const nets = touching(m).map(({ n }) => n!.net ?? n!.key);
    const [input, output] = m.key === 'fluid_extractor_lv' ? [`i:${K.oilBerry}`, `f:${K.oil}`] : [`f:${K.oil}`, `f:${K.sulfuricLightFuel}`];
    expect(nets, m.key).toContain(input);
    expect(nets, m.key).toContain(output);
    expect(nets.some((n) => n.startsWith('p:LV') || n.startsWith('transformer_')), m.key).toBe(true);
  }
});

test('the slice fits the cross-section: machine columns at z 0 and 1, everything within z -2..3 and y -1..3', () => {
  for (const b of slice.blocks) {
    expect(b.pos[2]).toBeGreaterThanOrEqual(-2);
    expect(b.pos[2]).toBeLessThanOrEqual(3);
    expect(b.pos[1]).toBeGreaterThanOrEqual(-1);
    expect(b.pos[1]).toBeLessThanOrEqual(3);
    if (CATALOG.get(b.key)!.kind === 'machine' && !b.key.startsWith('transformer')) expect([0, 1]).toContain(b.pos[2]);
  }
});

test('berries, light fuel and sulfuric light fuel run straight through the slice; power stays in it', () => {
  expect(slice.throughRuns.has('p:MV')).toBe(false);
  for (const id of [`i:${K.oilBerry}`, `f:${K.lightFuel}`, `f:${K.sulfuricLightFuel}`]) {
    const runs = slice.throughRuns.get(id);
    expect(runs?.length, id).toBeGreaterThan(0);
    for (const run of runs!) {
      expect(run.map((c) => c[0])).toEqual(Array.from({ length: slice.length }, (_, x) => x));
      expect(new Set(run.map((c) => `${c[1]},${c[2]}`)).size).toBe(1);
    }
  }
  expect(slice.throughRuns.has(`f:${K.oil}`)).toBe(false);
});

test('each generator pushes straight into a transformer, and no cable touches a generator', () => {
  const at = new Map(slice.blocks.map((b) => [posKey(b.pos), b]));
  const gens = slice.blocks.filter((b) => b.key.startsWith('combustion_generator'));
  expect(gens.length).toBeGreaterThan(0);
  for (const g of gens) {
    expect(at.get(posKey(addVec(g.pos, DIRS[g.facing!])))?.key, `generator at ${g.pos}`).toBe('transformer_mv_lv');
    for (const d of DIRS) expect(isConduit(at.get(posKey(addVec(g.pos, d)))) && at.get(posKey(addVec(g.pos, d)))!.key.includes('cable')).toBe(false);
  }
  expect(slice.blocks.some((b) => b.net === 'p:MV')).toBe(false);
});

test('no power cable is a dead end: every LV cable touches a machine it powers or leads on to one', () => {
  const at = new Map(slice.blocks.map((b) => [posKey(b.pos), b]));
  const masks = computeConnections(slice.blocks);
  const lv = slice.blocks.filter((b) => b.net?.startsWith('p:LV'));
  for (const c of lv) {
    const links = DIRS.map((d, side) => ({ n: at.get(posKey(addVec(c.pos, d))), on: ((masks.get(posKey(c.pos)) ?? 0) >> side) & 1 }))
      .filter(({ n, on }) => n && on);
    const powersMachine = links.some(({ n }) => !isConduit(n) && !n!.key.startsWith('transformer'));
    expect(powersMachine || links.length >= 2, `dead-end LV cable at ${c.pos}`).toBe(true);
  }
});
