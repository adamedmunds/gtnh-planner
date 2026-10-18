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
