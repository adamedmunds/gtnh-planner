import type { RecipeDb } from '../recipes/db';
import type { MachineRef, Recipe } from '../recipes/types';
import { hasLayout } from '../layout/multiblock';
import { V, tierForEut } from './tiers';

export const machineTier = (m: MachineRef) =>
  m.tier ?? (m.voltage !== undefined ? tierForEut(m.voltage) : Number.MAX_SAFE_INTEGER);

/** Multiblocks have no tier, so among them one that Build in 3D lays out (GT's own, not GT++'s) comes first. */
const laidOut = (m: MachineRef) => Number(!(m.multiblock && hasLayout(m.mID)));
const byTier = (a: MachineRef, b: MachineRef) => Number(a.multiblock) - Number(b.multiblock) || machineTier(a) - machineTier(b) || laidOut(a) - laidOut(b);

/** Legacy machine -> the craftable one replacing it; GT's "Pyrolyse Oven Conversion Recipe" (MTERecipeLoader) only converts the old oven into the new one. */
const REPLACED_BY: Record<number, number> = { 1159: 15546 };

/** Machines on the recipe's map with enough voltage for it: single blocks first, lowest tier first, laid-out multiblocks first. */
export function machineOptions(recipe: Recipe, db: RecipeDb): MachineRef[] {
  const map = db.map(recipe.map);
  const eutPerAmp = recipe.eut / Math.max(1, map.amperage);
  const ids = new Set(map.machines.map((m) => m.mID));
  return map.machines.filter((m) => !ids.has(REPLACED_BY[m.mID])).filter((m) => (m.voltage ?? (m.tier !== undefined ? V[m.tier] : Infinity)) >= eutPerAmp).sort(byTier);
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
