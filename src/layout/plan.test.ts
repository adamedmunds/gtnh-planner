import { emptyChain, type Chain } from '../calc/chain';
import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, line, reference, rn } from '../calculator/testChains';
import { RecipeDb, recipeSignature } from '../recipes/db';
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

// A Distillation Tower (HV) fed by the oil extractor: Oil -> five fluids, in a fixed order.
const TOWER_FLUIDS = ['fluid:fraction_a', 'fluid:fraction_b', 'fluid:fraction_c', 'fluid:fraction_d', 'fluid:fraction_e'];
const towerSetup = (mID = 1126, tier: number | null = 3, eut = 120, specialValue = 0) => {
  const data = oilBerryData();
  for (const k of TOWER_FLUIDS) data.resources.push({ key: k, name: `Fraction ${k.slice(-1).toUpperCase()}`, kind: 'fluid' });
  data.maps.push({ index: 5, id: 'gt.recipe.distillationtower', name: 'Distillation Tower', amperage: 1,
    machines: [{ mID, name: 'Distillation Tower', ...(tier === null ? {} : { tier }), multiblock: true }] });
  data.recipes.push({ id: 5, map: 5, eut, duration: 100, specialValue,
    inputs: [{ key: K.oil, amount: 1000, consumed: true }],
    outputs: TOWER_FLUIDS.map((key) => ({ key, amount: 100, chance: 1 })) });
  const towerDb = new RecipeDb(data);
  const node = (id: string, recipeId: number, machineMID: number) =>
    ({ id, kind: 'recipe', recipeSig: recipeSignature(towerDb.recipe(recipeId)!, towerDb), machineMID, overclock: false, position: { x: 0, y: 0 } }) as const;
  // 1.6 Oil Berry/s -> 160 L/s oil -> 0.8 towers (core) next to 1.6 extractors (2 slices).
  const chain: Chain = {
    ...emptyChain(),
    nodes: [node('fe', 0, 511), node('tower', 5, mID)],
    targets: [{ key: TOWER_FLUIDS[0], maximise: true }],
    limits: [{ key: K.oilBerry, maxRate: 1.6 }],
  };
  return { towerDb, chain };
};
const towerPlan = async (mID = 1126, tier: number | null = 3, style: 'modular' | 'straight' = 'modular', eut = 120, specialValue = 0) => {
  const { towerDb, chain } = towerSetup(mID, tier, eut, specialValue);
  return ok(await plan(chain, style, towerDb));
};
const inPlan = (p: LinePlan) => [...(p.slice ?? []), ...p.core, ...(p.straight ?? [])].find((m) => m.nodeId === 'tower')!;

test('an EBF is planned as itself with its recipe heat, and the notes name its coils and muffler', async () => {
  const p = await towerPlan(1000, 2, 'modular', 120, 2000);
  expect(inPlan(p)).toMatchObject({ key: 'gt_1000', heat: 2000 });
  expect(p.notes).toContain('The Distillation Tower uses Kanthal Heating Coils (its recipe needs 2,000 K)');
  expect(p.notes).toContain("Keep the block above the Distillation Tower's muffler hatch empty");
});

test('an EBF hotter than Nichrome keeps the stand-in, says why, and uses no power', async () => {
  const p = await towerPlan(1000, 3, 'modular', 120, 4500);
  expect(inPlan(p).key).toBe('marker_multiblock');
  expect(p.notes).toContain("The Distillation Tower's recipe needs 4,500 K; Nichrome coils with an HV energy hatch give 3,701 K. Build it yourself with better coils");
  expect(p.notes.some((n) => n.includes("multiblocks aren't laid out yet"))).toBe(false);
  expect(p.power.demand.HV ?? 0).toBe(0);
});

test('a distillation tower is planned as itself, its fluids in recipe order', async () => {
  const p = await towerPlan();
  const t = inPlan(p);
  expect(t.key).toBe('gt_1126');
  expect(t.machine).toMatchObject({ mID: 1126, multiblock: true, tier: 'HV' });
  expect(t.multiblock).toBe(true);
  expect(t.fluidOutputs).toEqual(TOWER_FLUIDS);
  expect(p.power.demand.HV).toBeGreaterThan(0);
  expect(p.power.tiers).toContain('HV');
});

test('a multiblock with no definition keeps the stand-in', async () => {
  const p = await towerPlan(9999);
  const t = inPlan(p);
  expect(t.key).toBe('marker_multiblock');
  expect(p.notes).toContain("Build the Distillation Tower here yourself (multiblocks aren't laid out yet)");
  expect(p.power.demand.HV).toBeUndefined();
});

test('a multiblock above HV keeps the stand-in', async () => {
  const p = await towerPlan(1126, 4);
  expect(inPlan(p).key).toBe('marker_multiblock');
});

test('a multiblock without a tier takes its recipe voltage', async () => {
  const p = await towerPlan(1126, null, 'modular', 480);
  const t = inPlan(p);
  expect(t.key).toBe('gt_1126');
  expect(t.machine).toMatchObject({ mID: 1126, multiblock: true, tier: 'HV' });
  expect(t.tier).toBe('HV');
  expect(p.power.demand.HV).toBeGreaterThan(0);
});

test('a multiblock without a tier whose recipe is above HV keeps the stand-in', async () => {
  const p = await towerPlan(1126, null, 'modular', 2000);
  expect(inPlan(p).key).toBe('marker_multiblock');
  expect(p.power.demand.HV).toBeUndefined();
});

test('a planned multiblock adds the maintenance note', async () => {
  const p = await towerPlan();
  expect(p.notes).toContain("Fix the Distillation Tower's maintenance hatch with tools after pasting it");
  expect(p.notes.some((n) => n.includes("multiblocks aren't laid out yet"))).toBe(false);
  expect(p.notes.some((n) => n.includes('Heating Coils'))).toBe(false);
});

test("the core's slice limit counts its multiblocks", async () => {
  const p = await towerPlan();
  expect(p.style).toBe('modular');
  expect(p.sliceCount).toBe(2);
  expect(p.core.map((m) => m.nodeId)).toEqual(['tower']);
  expect(p.core[0].count).toBe(1);
  expect(p.coreServes).toBe(2);
  expect(p.notes).toContain('This core handles up to 2 slices');
});
