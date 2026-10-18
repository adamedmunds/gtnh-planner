import { nodeRates } from './rates';
import type { ChainNode } from './chain';
import { RecipeDb, recipeSignature } from '../recipes/db';
import { K, oilBerryData } from '../test/oilBerryDb';
import type { AppRecipeData } from '../recipes/types';

const pos = { x: 0, y: 0 };
const db = new RecipeDb(oilBerryData());
const sig = (id: number, d = db) => recipeSignature(d.recipe(id)!, d);
const recipeNode = (id: number, machineMID: number, overclock = false, d = db): ChainNode =>
  ({ id: `n${id}`, kind: 'recipe', recipeSig: sig(id, d), machineMID, overclock, position: pos });

function rates(node: ChainNode, d = db) {
  const r = nodeRates(node, d);
  if (!r.valid) throw new Error(r.reason);
  return r;
}

test('LV fluid extractor: 1 berry/s in, 100 L/s oil out, 30 EU/t', () => {
  const r = rates(recipeNode(0, 511));
  expect(r.perMachine.get(K.oilBerry)).toBeCloseTo(-1);
  expect(r.perMachine.get(K.oil)).toBeCloseTo(100);
  expect(r.perMachine.get(K.eu)).toBe(-30);
  expect(r.approximate).toBe(false);
});

test('LV distillery: 33.3 L/s oil to sulfuric light fuel, circuit not consumed', () => {
  const r = rates(recipeNode(1, 531));
  expect(r.perMachine.get(K.oil)).toBeCloseTo(-100 / 3);
  expect(r.perMachine.get(K.sulfuricLightFuel)).toBeCloseTo(100 / 3);
  expect(r.perMachine.get(K.eu)).toBe(-24);
  expect(r.perMachine.has(K.circuit2)).toBe(false);
});

test('overclocked MV distillery: twice as fast, four times the EU/t', () => {
  const r = rates(recipeNode(1, 532, true));
  expect(r.perMachine.get(K.oil)).toBeCloseTo(-200 / 3);
  expect(r.perMachine.get(K.eu)).toBe(-96);
  expect(r.duration).toBe(15);
});

test('MV machine without overclock runs at base speed', () => {
  expect(rates(recipeNode(1, 532, false)).perMachine.get(K.eu)).toBe(-24);
});

test('chanced outputs are scaled by their chance', () => {
  const data: AppRecipeData = oilBerryData();
  data.recipes[0] = { ...data.recipes[0], outputs: [{ key: K.oil, amount: 100, chance: 0.25 }] };
  const d = new RecipeDb(data);
  expect(rates(recipeNode(0, 511, false, d), d).perMachine.get(K.oil)).toBeCloseTo(25);
});

test('LV electrolyzer cannot run the 120 EU/t recipe; MV can', () => {
  expect(nodeRates(recipeNode(4, 371), db)).toEqual({ valid: false, reason: 'machine tier too low' });
  expect(rates(recipeNode(4, 372)).perMachine.get(K.eu)).toBe(-120);
});

test('ULV recipe on an LV machine with overclock: one overclock, never zero duration', () => {
  const data = oilBerryData();
  data.recipes.push({ id: 5, map: 0, eut: 7, duration: 100, specialValue: 0,
    inputs: [{ key: K.oilBerry, amount: 1, consumed: true }], outputs: [{ key: K.oil, amount: 10, chance: 1 }] });
  const d = new RecipeDb(data);
  const r = rates(recipeNode(5, 511, true, d), d);
  expect(r.eut).toBe(28);
  expect(r.duration).toBe(50);
});

test('missing recipe signature is invalid', () => {
  const node: ChainNode = { id: 'x', kind: 'recipe', recipeSig: 'gt.recipe.distillery|a|b', machineMID: 531, overclock: false, position: pos };
  expect(nodeRates(node, db)).toEqual({ valid: false, reason: 'missing recipe' });
});

test('MV combustion generator burning light fuel', () => {
  const gen: ChainNode = { id: 'g', kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: K.lightFuel, machineMID: 1111, position: pos };
  const r = rates(gen);
  expect(r.perMachine.get(K.eu)).toBe(128);
  expect(r.perMachine.get(K.lightFuel)).toBeCloseTo(-(128 * 20) / (305 * 0.9));
});

test('generator node on a format-1 database asks for a re-dump', () => {
  const data = oilBerryData();
  data.dumpFormat = 1;
  for (const m of data.maps[4].machines) delete m.generator;
  const d = new RecipeDb(data);
  const gen: ChainNode = { id: 'g', kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: K.lightFuel, machineMID: 1111, position: pos };
  expect(nodeRates(gen, d)).toEqual({ valid: false, reason: 're-dump to enable generators' });
});
