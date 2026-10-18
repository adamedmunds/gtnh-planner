import { emptyChain, type Chain } from '../calc/chain';
import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, line, reference, rn } from '../calculator/testChains';
import { RecipeDb } from '../recipes/db';
import { K, oilBerryData } from '../test/oilBerryDb';
import { planLine } from './plan';
import type { LinePlan, PlanMachine } from './types';

const plan = async (chain: Chain, style: 'modular' | 'straight' = 'modular', withDb = db) => {
  const screen = await solveForScreen(chain, withDb, await createHighsSolver());
  return planLine(chain, withDb, screen, style);
};
const ok = (p: Awaited<ReturnType<typeof plan>>): LinePlan => {
  if ('error' in p) throw new Error(p.error);
  return p;
};
const counts = (ms: PlanMachine[] | undefined) => Object.fromEntries((ms ?? []).map((m) => [m.key, m.count]));

test('oil line: 6 slices of 1 extractor, 3 distilleries, 1 generator; core = reactor + electrolyzer', async () => {
  const p = ok(await plan(reference()));
  expect(p.style).toBe('modular');
  expect(p.sliceCount).toBe(6);
  expect(counts(p.slice)).toEqual({ fluid_extractor_lv: 1, distillery_lv: 3, combustion_generator_mv: 1 });
  expect(counts(p.core)).toEqual({ chemical_reactor_lv: 1, electrolyzer_mv: 1 });
  expect(p.coreServes).toBe(15);
  expect(p.fallback).toBeUndefined();
  expect(p.notes).toContain('6 slices for 5.57 Oil Berry/s · paste more slices on either end to grow it');
  expect(p.notes).toContain('This core handles up to 15 slices');
});

test('networks and markers', async () => {
  const p = ok(await plan(reference()));
  const keys = p.networks.map((n) => n.key);
  for (const k of [K.oil, K.sulfuricLightFuel, K.lightFuel, K.hydrogenCell, K.h2sCell, K.emptyCell]) expect(keys).toContain(k);
  expect(p.networks.find((n) => n.key === K.oil)).toMatchObject({ kind: 'fluid', producers: ['fe'], consumers: ['dist'] });
  expect(p.markers).toEqual(expect.arrayContaining([
    { id: `in:${K.oilBerry}`, key: K.oilBerry, dir: 'in', kind: 'item' },
    { id: `out:${K.lightFuel}`, key: K.lightFuel, dir: 'out', kind: 'fluid' },
    { id: `out:${K.sulfur}`, key: K.sulfur, dir: 'out', kind: 'item' },
  ]));
  expect(p.networks.find((n) => n.key === K.lightFuel)!.consumers).toEqual(expect.arrayContaining(['gen', `out:${K.lightFuel}`]));
});

test('power: MV generators, LV and MV machines → one MV→LV step', async () => {
  const p = ok(await plan(reference()));
  expect(p.power.tiers).toEqual(['LV', 'MV']);
  expect(p.power.source).toEqual({ kind: 'generators', tier: 'MV' });
  expect(p.power.transformers).toEqual([{ from: 'MV', to: 'LV', count: 5 }]); // 579 EU/t of LV machines / 128
});

test('straight style keeps the Calculator counts', async () => {
  const p = ok(await plan(reference(), 'straight'));
  expect(p.style).toBe('straight');
  expect(counts(p.straight)).toEqual({ fluid_extractor_lv: 6, distillery_lv: 17, chemical_reactor_lv: 1, electrolyzer_mv: 1, combustion_generator_mv: 5 });
});

test('a line that does not repeat falls back to straight with a plain reason', async () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('cr', 3, 421)], targets: [{ key: K.lightFuel, maximise: true }] };
  const p = ok(await plan(chain));
  expect(p.style).toBe('straight');
  expect(p.fallback).toBe("This line doesn't repeat, so it's laid out in a straight line.");
});

test('power from outside', async () => {
  const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, rate: 100 }] };
  const p = ok(await plan(chain));
  expect(p.power.source).toMatchObject({ kind: 'outside', tier: 'MV' });
  expect(p.markers).toContainEqual({ id: 'power', key: 'eu', dir: 'in', kind: 'power' });
});

test('an EV machine is refused in plain words', async () => {
  const data = oilBerryData();
  const el = data.maps[3].machines.find((m) => m.mID === 372)!;
  el.tier = 4;
  el.voltage = 2048;
  const evDb = new RecipeDb(data);
  const p = await plan(reference(), 'modular', evDb);
  expect(p).toEqual({ error: "Can't build power for this line yet (needs EV)" });
});
