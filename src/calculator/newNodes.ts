import type { Chain } from '../calc/chain';
import { defaultMachine, generatorOptions } from '../calc/machines';
import { recipeSignature, type RecipeDb } from '../recipes/db';
import type { Fuel, Recipe } from '../recipes/types';
import type { NewNode } from './chainState';
import { placeNewNode } from './layout';

/** A node for `recipe` on `machineMID` (default: the cheapest machine that can run it), placed next to its neighbours. */
export function newRecipeNode(recipe: Recipe, chain: Chain, db: RecipeDb, machineMID?: number): NewNode | undefined {
  const mID = machineMID ?? defaultMachine(recipe, db)?.mID;
  if (mID === undefined) return undefined;
  const io = {
    inputs: recipe.inputs.filter((s) => s.consumed !== false).map((s) => s.key),
    outputs: recipe.outputs.map((s) => s.key),
  };
  return { kind: 'recipe', recipeSig: recipeSignature(recipe, db), machineMID: mID, overclock: false, position: placeNewNode(chain, db, io) };
}

/** A generator node burning `fuel` in the lowest-tier generator on its map. */
export function newGeneratorNode(fuel: Fuel, chain: Chain, db: RecipeDb): NewNode | undefined {
  const machine = generatorOptions(fuel.map, db)[0];
  if (!machine) return undefined;
  return {
    kind: 'generator',
    fuelMap: db.map(fuel.map).id,
    fuelKey: fuel.key,
    machineMID: machine.mID,
    position: placeNewNode(chain, db, { inputs: [fuel.key], outputs: [] }),
  };
}
