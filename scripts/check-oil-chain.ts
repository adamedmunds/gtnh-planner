/**
 * Solves the oil berry chain against the real imported recipes (public/data/recipes.json.gz) and prints the result,
 * to compare with the calculator's reference test. Run `npm run recipes` first.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync, strFromU8 } from 'fflate';
import { RecipeDb, recipeSignature } from '../src/recipes/db';
import type { AppRecipeData, Recipe } from '../src/recipes/types';
import { emptyChain, type ChainNode } from '../src/calc/chain';
import { solveChain } from '../src/calc/solve';
import { createHighsSolver } from '../src/calc/solver/highs';

const data = JSON.parse(strFromU8(gunzipSync(new Uint8Array(readFileSync('public/data/recipes.json.gz'))))) as AppRecipeData;
const db = new RecipeDb(data);
const key = (name: string) => {
  const r = db.search(name, 5).find((x) => x.name === name);
  if (!r) throw new Error(`No resource named ${name}`);
  return r.key;
};
const K = {
  oilBerry: key('Oil Berry'), oil: key('Oil'), slf: key('Sulfuric Light Fuel'), lf: key('Light Fuel'),
  h2Cell: key('Hydrogen Cell'), h2sCell: key('Hydrogen Sulfide Cell'),
};
const find = (mapId: string, pred: (r: Recipe) => boolean) => {
  const map = db.mapIndexById(mapId)!;
  const r = [...db.producersOf(K.oil), ...db.producersOf(K.slf), ...db.producersOf(K.lf), ...db.producersOf(K.h2Cell)]
    .find((x) => x.map === map && pred(x));
  if (!r) throw new Error(`Recipe not found in ${mapId}`);
  return r;
};
const has = (r: Recipe, k: string) => r.inputs.some((s) => s.key === k);
const pos = { x: 0, y: 0 };
const node = (id: string, r: Recipe, machineMID: number): ChainNode =>
  ({ id, kind: 'recipe', recipeSig: recipeSignature(r, db), machineMID, overclock: false, position: pos });

const nodes: ChainNode[] = [
  node('fe', find('gt.recipe.fluidextractor', (r) => has(r, K.oilBerry)), 511),
  node('dist', find('gt.recipe.distillery', (r) => has(r, K.oil) && r.outputs.some((o) => o.key === K.slf)), 531),
  node('cr', find('gt.recipe.chemicalreactor', (r) => has(r, K.slf) && has(r, K.h2Cell)), 421),
  node('el', find('gt.recipe.electrolyzer', (r) => has(r, K.h2sCell)), 372),
];
const generator: ChainNode = { id: 'gen', kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: K.lf, machineMID: 1111, position: pos };

const solver = await createHighsSolver();
const selfPowered = db.dumpFormat === 2;
if (!selfPowered) console.log('Format-1 data: generators unavailable, solving with power bought in (re-dump to enable).');
const r = await solveChain(
  {
    ...emptyChain(),
    nodes: selfPowered ? [...nodes, generator] : nodes,
    targets: [{ key: K.lf, maximise: true }],
    limits: [{ key: K.oilBerry, maxRate: 5.57 }],
  },
  db,
  solver,
);
console.log(`status ${r.status}${r.message ? `: ${r.message}` : ''}`);
for (const n of r.nodes) console.log(`  ${n.id.padEnd(4)} ${n.machines.toFixed(4)} machines (build ${n.build})${n.invalid ? ` INVALID: ${n.invalid}` : ''}`);
console.log(`  EU used ${r.euUsed.toFixed(1)} EU/t, made ${r.euMade.toFixed(1)} EU/t`);
for (const [k, v] of r.outputs) console.log(`  output ${db.resource(k)?.name}: ${v.toFixed(2)}/s`);
for (const [k, v] of r.byproducts) console.log(`  byproduct ${db.resource(k)?.name}: ${v.toFixed(4)}/s`);
for (const [k, v] of r.inputs) console.log(`  input ${db.resource(k)?.name}: ${v.toFixed(4)}/s`);
