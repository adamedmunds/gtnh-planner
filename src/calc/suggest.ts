import { recipeSignature, type RecipeDb } from '../recipes/db';
import type { MachineRef, Recipe, ResourceKey } from '../recipes/types';
import type { Chain } from './chain';
import { V, tierForEut } from './tiers';

export interface Suggestion {
  recipe: Recipe;
  /** Lowest-tier machine that can run it. */
  machine: MachineRef;
  /** Inputs nothing in the chain makes yet. */
  newExternals: ResourceKey[];
  /** Uses something the chain already makes (e.g. turns a byproduct back into an input). */
  closesLoop: boolean;
}

const machineTier = (m: MachineRef) => m.tier ?? (m.voltage !== undefined ? tierForEut(m.voltage) : Number.MAX_SAFE_INTEGER);

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
    const map = db.map(recipe.map);
    const eutPerAmp = recipe.eut / Math.max(1, map.amperage);
    const machine = [...map.machines]
      .filter((m) => (m.voltage ?? (m.tier !== undefined ? V[m.tier] : Infinity)) >= eutPerAmp)
      .sort((a, b) => Number(a.multiblock) - Number(b.multiblock) || machineTier(a) - machineTier(b))[0];
    if (!machine) continue;
    const consumed = recipe.inputs.filter((s) => s.consumed !== false).map((s) => s.key);
    out.push({
      recipe,
      machine,
      newExternals: consumed.filter((k) => !made.has(k)),
      closesLoop: consumed.some((k) => made.has(k)),
    });
  }
  out.sort(
    (a, b) =>
      Number(b.closesLoop) - Number(a.closesLoop) ||
      machineTier(a.machine) - machineTier(b.machine) ||
      a.newExternals.length - b.newExternals.length ||
      a.recipe.eut - b.recipe.eut,
  );
  return out.slice(0, limit);
}
