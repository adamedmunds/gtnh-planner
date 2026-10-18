import { recipeSignature, type RecipeDb } from '../recipes/db';
import type { MachineRef, Recipe, ResourceKey } from '../recipes/types';
import type { Chain } from './chain';
import { defaultMachine, machineTier } from './machines';

export interface Suggestion {
  recipe: Recipe;
  /** Lowest-tier machine that can run it. */
  machine: MachineRef;
  /** Inputs nothing in the chain makes yet. */
  newExternals: ResourceKey[];
  /** Uses something the chain already makes (e.g. turns a byproduct back into an input). */
  closesLoop: boolean;
  /** How many of its inputs the chain already makes. */
  loops: number;
  /** Just empties a container of the resource (a cell, bucket or capsule) rather than making it. */
  unpacks: boolean;
}

/** Ranked recipes that could make `key` for this chain. Never picks for the user; the UI shows the list. */
export function suggestFor(key: ResourceKey, chain: Chain, db: RecipeDb, limit = 10): Suggestion[] {
  const inChain = new Set<string>();
  const made = new Set<ResourceKey>();
  for (const n of chain.nodes) {
    if (n.kind !== 'recipe') continue;
    inChain.add(n.recipeSig);
    const r = db.bySignature(n.recipeSig);
    if (r) for (const s of r.outputs) made.add(s.key);
  }

  const out: Suggestion[] = [];
  for (const recipe of db.producersOf(key)) {
    if (inChain.has(recipeSignature(recipe, db))) continue;
    const machine = defaultMachine(recipe, db);
    if (!machine) continue;
    const consumed = recipe.inputs.filter((s) => s.consumed !== false).map((s) => s.key);
    out.push({
      recipe,
      machine,
      newExternals: consumed.filter((k) => !made.has(k)),
      closesLoop: consumed.some((k) => made.has(k)),
      loops: consumed.filter((k) => made.has(k)).length,
      unpacks: consumed.some((k) => db.containerFluid(k) === key),
    });
  }
  out.sort(
    (a, b) =>
      Number(a.unpacks) - Number(b.unpacks) ||
      b.loops - a.loops ||
      machineTier(a.machine) - machineTier(b.machine) ||
      a.newExternals.length - b.newExternals.length ||
      a.recipe.eut - b.recipe.eut,
  );
  return out.slice(0, limit);
}
