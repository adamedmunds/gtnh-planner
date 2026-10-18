import { emptyChain, type Chain, type ChainNode } from '../calc/chain';
import { solveChain } from '../calc/solve';
import { createHighsSolver } from '../calc/solver/highs';
import { RecipeDb, recipeSignature } from '../recipes/db';
import { K, oilBerryData } from '../test/oilBerryDb';

/** Test helpers: the oil berry fixture as chains. */
export const db = new RecipeDb(oilBerryData());
const pos = { x: 0, y: 0 };
export const rn = (id: string, recipeId: number, machineMID: number): ChainNode =>
  ({ id, kind: 'recipe', recipeSig: recipeSignature(db.recipe(recipeId)!, db), machineMID, overclock: false, position: pos });
export const gen: ChainNode = { id: 'gen', kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: K.lightFuel, machineMID: 1111, position: pos };
export const line = () => [rn('fe', 0, 511), rn('dist', 1, 531), rn('cr', 3, 421), rn('el', 4, 372)];

/** Self-powered line, maximise Light Fuel, Oil Berry ≤ 5.57/s. */
export const reference = (): Chain => ({
  ...emptyChain(),
  nodes: [...line(), gen],
  targets: [{ key: K.lightFuel, maximise: true }],
  limits: [{ key: K.oilBerry, maxRate: 5.57 }],
});

let solver: ReturnType<typeof createHighsSolver> | undefined;
export const solve = async (chain: Chain) => solveChain(chain, db, await (solver ??= createHighsSolver()));
