import { emptyChain, type Chain } from '../calc/chain';
import { recipeSignature } from '../recipes/db';
import { K } from '../test/oilBerryDb';
import { COLUMN } from './layout';
import { newGeneratorNode, newRecipeNode } from './newNodes';
import { db, rn } from './testChains';

test('a recipe node uses the default machine and sits left of its consumer', () => {
  const chain: Chain = { ...emptyChain(), nodes: [{ ...rn('dist', 1, 531), position: { x: 400, y: 0 } }] };
  const node = newRecipeNode(db.recipe(0)!, chain, db);
  expect(node).toEqual({ kind: 'recipe', recipeSig: recipeSignature(db.recipe(0)!, db), machineMID: 511, overclock: false, position: { x: 400 - COLUMN, y: 0 } });
});

test('a recipe node can take a chosen machine', () => {
  expect(newRecipeNode(db.recipe(1)!, emptyChain(), db, 532)?.machineMID).toBe(532);
});

test('a generator node burns the fuel in the lowest-tier generator', () => {
  const node = newGeneratorNode(db.fuelUsesOf(K.lightFuel)[0], emptyChain(), db);
  expect(node).toEqual({ kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: K.lightFuel, machineMID: 1110, position: { x: 0, y: 0 } });
});
