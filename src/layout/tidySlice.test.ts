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
    for (const w of [1, 2]) {
      const r = tidySlice(arr, nets, plan, { serviceWidth: w });
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
const isFeed = (b: PlacedBlock) => b.pos[1] === 1 && Math.abs(b.pos[2]) === 2;

test('oil slice is tidy: outside the service column conduits connect only along x, to what they serve, or to the feed', () => {
  const cells = at(slice.blocks);
  const masks = computeConnections(slice.blocks);
  for (const b of slice.blocks) {
    if (!isConduit(b) || b.pos[0] >= slice.serviceFrom) continue;
    DIRS.forEach((d, side) => {
      if (side >= 4 || !((masks.get(posKey(b.pos)) ?? 0) & (1 << side))) return;
      const n = cells.get(posKey(addVec(b.pos, d)));
      const ok = (n && !isConduit(n)) || (n && (isFeed(b) || isFeed(n)) && b.net?.startsWith('p:') && n.net?.startsWith('p:'));
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

test('the slice fits the cross-section and keeps the walkway clear', () => {
  for (const b of slice.blocks) {
    expect(Math.abs(b.pos[2])).toBeLessThanOrEqual(3);
    expect(b.pos[1]).toBeGreaterThanOrEqual(-1);
    expect(b.pos[1]).toBeLessThanOrEqual(3);
    if (b.pos[2] === 0) expect(b.pos[1] >= 2 && b.pos[0] >= slice.serviceFrom, `${b.key} at ${b.pos}`).toBe(true);
  }
});

test('berries, light fuel, sulfuric light fuel and the MV feed run straight through the slice', () => {
  for (const id of [`i:${K.oilBerry}`, `f:${K.lightFuel}`, `f:${K.sulfuricLightFuel}`, 'p:MV']) {
    const runs = slice.throughRuns.get(id);
    expect(runs?.length, id).toBeGreaterThan(0);
    for (const run of runs!) {
      expect(run.map((c) => c[0])).toEqual(Array.from({ length: slice.length }, (_, x) => x));
      expect(new Set(run.map((c) => `${c[1]},${c[2]}`)).size).toBe(1);
    }
  }
  expect(slice.throughRuns.has(`f:${K.oil}`)).toBe(false);
});

test('the MV feed is the only MV run: generator backs stay one-block links down to it', () => {
  const mv = slice.blocks.filter((b) => b.net === 'p:MV');
  for (const b of mv) if (b.pos[0] < slice.serviceFrom && !(b.pos[1] === 1 && Math.abs(b.pos[2]) === 2)) {
    expect(slice.blocks.some((g) => g.key.startsWith('combustion_generator') && g.pos[0] === b.pos[0] && g.pos[1] === b.pos[1]), `${b.pos}`).toBe(true);
  }
  for (const run of slice.throughRuns.get('p:MV')!) expect(run[0][1]).toBe(1);
});
