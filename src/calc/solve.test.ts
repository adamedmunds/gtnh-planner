import { solveChain, type ChainResult } from './solve';
import { emptyChain, type Chain, type ChainNode } from './chain';
import { createHighsSolver } from './solver/highs';
import type { LpSolver } from './solver/types';
import { RecipeDb, recipeSignature } from '../recipes/db';
import { K, oilBerryData } from '../test/oilBerryDb';

const db = new RecipeDb(oilBerryData());
const pos = { x: 0, y: 0 };
const rn = (id: string, recipeId: number, machineMID: number): ChainNode =>
  ({ id, kind: 'recipe', recipeSig: recipeSignature(db.recipe(recipeId)!, db), machineMID, overclock: false, position: pos });
const gen: ChainNode = { id: 'gen', kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: K.lightFuel, machineMID: 1111, position: pos };
const line = [rn('fe', 0, 511), rn('dist', 1, 531), rn('cr', 3, 421), rn('el', 4, 372)];

let solver: LpSolver;
beforeAll(async () => {
  solver = await createHighsSolver();
});

const machines = (r: ChainResult, id: string) => r.nodes.find((n) => n.id === id)!.machines;
const within = (actual: number, expected: number, pct = 0.5) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * (pct / 100));

test('reference: oil berry line, 5.57 berries/s, self-powered, maximise light fuel', async () => {
  const chain: Chain = {
    ...emptyChain(),
    nodes: [...line, gen],
    targets: [{ key: K.lightFuel, maximise: true }],
    limits: [{ key: K.oilBerry, maxRate: 5.57 }],
  };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('ok');
  within(machines(r, 'fe'), 5.57);
  within(machines(r, 'dist'), 16.71);
  within(machines(r, 'cr'), 0.3713);
  within(machines(r, 'el'), 0.1671);
  expect(r.nodes.find((n) => n.id === 'dist')!.build).toBe(17);
  within(r.byproducts.get(K.sulfur)!, 0.0464);
  expect(r.inputs.has(K.hydrogenCell)).toBe(false);
  expect(r.byproducts.has(K.hydrogenCell)).toBe(false);
  within(r.euUsed, 599.3);
  within(r.outputs.get(K.lightFuel)!, 513.25); // 557 - 599.3 x 20 / 274 (GT truncates EU/L)
});

test('rate mode: 100 L/s light fuel with power bought in', async () => {
  const chain: Chain = { ...emptyChain(), nodes: line, targets: [{ key: K.lightFuel, rate: 100 }] };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('ok');
  within(machines(r, 'fe'), 1.0);
  within(machines(r, 'dist'), 3.0);
  within(machines(r, 'cr'), 0.0667);
  within(machines(r, 'el'), 0.03);
  within(r.inputs.get(K.oilBerry)!, 1.0);
  within(r.euUsed, 107.6);
  expect(r.euMade).toBe(0);
});

test('infeasible: 1000 L/s with only 5.57 berries/s names the shortfall', async () => {
  const chain: Chain = {
    ...emptyChain(),
    nodes: [...line, gen],
    targets: [{ key: K.lightFuel, rate: 1000 }],
    limits: [{ key: K.oilBerry, maxRate: 5.57 }],
  };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('infeasible');
  expect(r.shortfalls[0].key).toBe(K.lightFuel);
  expect(r.shortfalls[0].needed).toBe(1000);
  within(r.shortfalls[0].available, 513.3);
  expect(r.bindingLimits).toEqual([{ key: K.oilBerry, maxRate: 5.57 }]);
  expect(r.message).toMatch(/Oil Berry/);
});

test('a rate target nothing valid can make is infeasible with nothing available', async () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('el', 4, 371)], targets: [{ key: K.sulfur, rate: 1 }] };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('infeasible');
  expect(r.shortfalls).toEqual([{ key: K.sulfur, needed: 1, available: 0 }]);
});

test('a maximise target nothing makes is infeasible with a message', async () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('fe', 0, 511)], targets: [{ key: K.sulfur, maximise: true }], limits: [{ key: K.oilBerry, maxRate: 1 }] };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('infeasible');
  expect(r.message).toMatch(/Sulfur Dust/);
});

test('unbounded: maximise without a supply limit asks for one', async () => {
  const chain: Chain = { ...emptyChain(), nodes: [...line, gen], targets: [{ key: K.lightFuel, maximise: true }] };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('unbounded');
  expect(r.message).toMatch(/Oil Berry/);
  expect(r.message).toMatch(/Light Fuel/);
});

test('a node whose recipe is missing is flagged and the rest still solves', async () => {
  const bogus: ChainNode = { id: 'bogus', kind: 'recipe', recipeSig: 'gt.recipe.distillery|x|y', machineMID: 531, overclock: false, position: pos };
  const chain: Chain = { ...emptyChain(), nodes: [...line, bogus], targets: [{ key: K.lightFuel, rate: 100 }] };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('ok');
  expect(r.nodes.find((n) => n.id === 'bogus')!.invalid).toBe('missing recipe');
  within(machines(r, 'cr'), 0.0667);
});

test('an LV electrolyzer is invalid, so hydrogen becomes an external input', async () => {
  const chain: Chain = {
    ...emptyChain(),
    nodes: [rn('fe', 0, 511), rn('dist', 1, 531), rn('cr', 3, 421), rn('el', 4, 371)],
    targets: [{ key: K.lightFuel, rate: 100 }],
  };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('ok');
  expect(r.nodes.find((n) => n.id === 'el')!.invalid).toBe('machine tier too low');
  expect(r.inputs.get(K.hydrogenCell)).toBeGreaterThan(0);
});

test('machine cap: 4 distilleries scale the reference line', async () => {
  const chain: Chain = {
    ...emptyChain(),
    nodes: [rn('fe', 0, 511), { ...rn('dist', 1, 531), maxMachines: 4 }, rn('cr', 3, 421), rn('el', 4, 372), gen],
    targets: [{ key: K.lightFuel, maximise: true }],
    limits: [{ key: K.oilBerry, maxRate: 5.57 }],
  };
  const r = await solveChain(chain, db, solver);
  expect(r.status).toBe('ok');
  within(machines(r, 'dist'), 4);
  within(r.outputs.get(K.lightFuel)!, (513.25 * 4) / 16.71);
  expect(r.bindingMachines).toEqual([{ id: 'dist', maxMachines: 4 }]);
  expect(r.bindingLimits).toEqual([]);
});
