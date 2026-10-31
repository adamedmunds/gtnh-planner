import type { AppRecipeData, MachineRef, Recipe, Resource } from './types';

/** GT's NEI-only Large Boiler map: one recipe per fuel, 1000 L in, nothing out, 0 EU/t. */
export const LARGE_BOILER_MAP = 'gt.recipe.largeboilerfakefuels';

/** The craftable Large Steel Boiler (MTELargeBoilerSteel); 1021 is the legacy one, which only converts into this. */
export const LARGE_STEEL_BOILER: MachineRef = { mID: 15530, name: 'Large Steel Boiler', multiblock: true };

/** MTELargeBoilerSteel.EUT_GENERATED: steam per tick is twice this at full efficiency (MTELargeBoilerBase.onRunningTick). */
const STEEL_EUT = 1200;
const STEAM_PER_TICK = STEEL_EUT * 2;
/** L/s of steam a Large Steel Boiler makes at full efficiency. */
export const BOILER_STEAM = STEAM_PER_TICK * 20;
/** GTValues.STEAM_PER_WATER. */
const STEAM_PER_WATER = 160;

const STEAM: Resource = { key: 'fluid:steam', name: 'Steam', kind: 'fluid' };
const WATER: Resource = { key: 'fluid:water', name: 'Water', kind: 'fluid' };

/** One fluid fuel, 1000 L, nothing out: the fake-fuel recipes a Large Boiler can burn for steam. */
const isFluidFuel = (r: Recipe) =>
  r.outputs.length === 0 && r.inputs.length === 1 && r.inputs[0].key.startsWith('fluid:') && r.inputs[0].amount === 1000;

/**
 * The Large Boiler map as the Large Steel Boiler runs it: each fluid fuel recipe becomes fuel + water -> steam. 1000 L
 * of fuel lasts the recipe's duration in ticks in a Steel boiler (LargeBoilerFuelBackend stores the Steel burn time as
 * mDuration), making 2,400 L of steam a tick from 15 L of water. The map offers only the Steel boiler: the others make a
 * different amount of steam from the same fuel. Solid fuels keep their recipes (the dump only has fuel value / 1600).
 */
export function withBoilerSteam(data: AppRecipeData): AppRecipeData {
  const map = data.maps.find((m) => m.id === LARGE_BOILER_MAP);
  if (!map) return data;
  const recipes = data.recipes.map((r) => {
    if (r.map !== map.index || !isFluidFuel(r)) return r;
    return {
      ...r,
      inputs: [...r.inputs, { key: WATER.key, amount: (STEAM_PER_TICK * r.duration) / STEAM_PER_WATER, consumed: true }],
      outputs: [{ key: STEAM.key, amount: STEAM_PER_TICK * r.duration, chance: 1 }],
    };
  });
  const known = new Set(data.resources.map((r) => r.key));
  return {
    ...data,
    maps: data.maps.map((m) => (m === map ? { ...m, machines: [LARGE_STEEL_BOILER] } : m)),
    recipes,
    resources: [...data.resources, ...[STEAM, WATER].filter((r) => !known.has(r.key))],
  };
}
