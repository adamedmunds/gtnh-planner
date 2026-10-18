import { suggestFor } from './suggest';
import { emptyChain, type Chain, type ChainNode } from './chain';
import { RecipeDb, recipeSignature } from '../recipes/db';
import { K, oilBerryData } from '../test/oilBerryDb';

const db = new RecipeDb(oilBerryData());
const pos = { x: 0, y: 0 };
const rn = (id: string, recipeId: number, machineMID: number): ChainNode =>
  ({ id, kind: 'recipe', recipeSig: recipeSignature(db.recipe(recipeId)!, db), machineMID, overclock: false, position: pos });

test('hydrogen cells for a chain with the chemical reactor: the electrolyzer, closing the loop, on an MV machine', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('cr', 3, 421)] };
  const [first] = suggestFor(K.hydrogenCell, chain, db);
  expect(first.recipe.id).toBe(4);
  expect(first.closesLoop).toBe(true);
  expect(first.machine.mID).toBe(372);
  expect(first.newExternals).toEqual([]);
});

test('oil: the fluid extractor on the lowest-tier machine, with oil berries as a new input', () => {
  const [first] = suggestFor(K.oil, emptyChain(), db);
  expect(first.recipe.id).toBe(0);
  expect(first.machine.mID).toBe(511);
  expect(first.newExternals).toEqual([K.oilBerry]);
  expect(first.closesLoop).toBe(false);
});

test('recipes already in the chain are not suggested', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('fe', 0, 511)] };
  expect(suggestFor(K.oil, chain, db)).toEqual([]);
});

test('nothing makes it: no suggestions', () => {
  expect(suggestFor(K.oilBerry, emptyChain(), db)).toEqual([]);
});

test('emptying a fluid container ranks after real production', () => {
  const data = oilBerryData();
  const cell = 'item:x:oilcell@0';
  data.resources.push({ key: cell, name: 'Oil Cell', kind: 'item' });
  data.recipes.push({ id: data.recipes.length, map: 0, eut: 1, duration: 10, specialValue: 0,
    inputs: [{ key: cell, amount: 1, consumed: true }], outputs: [{ key: K.oil, amount: 1000, chance: 1 }] });
  data.containers = [{ item: cell, fluid: K.oil, amount: 1000 }];
  const withCell = new RecipeDb(data);
  expect(withCell.containerFluid(cell)).toBe(K.oil);
  expect(suggestFor(K.oil, emptyChain(), withCell).map((s) => s.recipe.inputs[0].key)).toEqual([K.oilBerry, cell]);
});

test('recipes that use more of what the chain makes rank first', () => {
  const data = oilBerryData();
  const water = 'fluid:water';
  data.resources.push({ key: water, name: 'Water', kind: 'fluid' });
  // LV decoy: Empty Cell + water -> Hydrogen Cell. Uses one chain resource; the H2S recipe (MV) uses two.
  data.recipes.push({ id: data.recipes.length, map: 3, eut: 30, duration: 100, specialValue: 0,
    inputs: [{ key: K.emptyCell, amount: 1, consumed: true }, { key: water, amount: 500, consumed: true }],
    outputs: [{ key: K.hydrogenCell, amount: 1, chance: 1 }] });
  const withWater = new RecipeDb(data);
  const chain: Chain = { ...emptyChain(), nodes: [{ ...rn('cr', 3, 421) }] };
  expect(suggestFor(K.hydrogenCell, chain, withWater).map((s) => s.recipe.id)).toEqual([4, data.recipes.length - 1]);
});
