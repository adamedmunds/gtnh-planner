import type { RecipeDb } from '../recipes/db';
import type { MachineRef, Recipe } from '../recipes/types';
import { V, tierForEut } from './tiers';

export const machineTier = (m: MachineRef) =>
  m.tier ?? (m.voltage !== undefined ? tierForEut(m.voltage) : Number.MAX_SAFE_INTEGER);

const byTier = (a: MachineRef, b: MachineRef) => Number(a.multiblock) - Number(b.multiblock) || machineTier(a) - machineTier(b);

/** Machines on the recipe's map with enough voltage for it: single blocks first, lowest tier first. */
export function machineOptions(recipe: Recipe, db: RecipeDb): MachineRef[] {
  const map = db.map(recipe.map);
  const eutPerAmp = recipe.eut / Math.max(1, map.amperage);
  return map.machines.filter((m) => (m.voltage ?? (m.tier !== undefined ? V[m.tier] : Infinity)) >= eutPerAmp).sort(byTier);
}

/** The cheapest machine that can run the recipe. */
export function defaultMachine(recipe: Recipe, db: RecipeDb): MachineRef | undefined {
  return machineOptions(recipe, db)[0];
}

/** Generators on a fuel map, lowest tier first (format-1 dumps have no generator stats, so every machine). */
export function generatorOptions(mapIndex: number, db: RecipeDb): MachineRef[] {
  const machines = db.map(mapIndex).machines;
  return (db.dumpFormat === 2 ? machines.filter((m) => m.generator) : [...machines]).sort(byTier);
}
