import type { RecipeDb } from '../recipes/db';
import { EU, type MachineRef, type ResourceKey } from '../recipes/types';
import type { ChainNode } from './chain';
import { V, overclock, tierForEut } from './tiers';

export type NodeRates =
  | {
      valid: true;
      /** Per machine: items/fluids per second (+ produced, − consumed); `eu` in EU/t. */
      perMachine: Map<ResourceKey, number>;
      eut: number;
      duration: number;
      /** Multiblock or unknown voltage: calculated like a single block, may be off. */
      approximate: boolean;
    }
  | { valid: false; reason: string };

const invalid = (reason: string): NodeRates => ({ valid: false, reason });

function add(m: Map<ResourceKey, number>, key: ResourceKey, v: number) {
  m.set(key, (m.get(key) ?? 0) + v);
}

function machineTier(m: MachineRef): number | undefined {
  if (m.tier !== undefined) return m.tier;
  if (m.voltage !== undefined) return tierForEut(m.voltage);
  return undefined;
}

/**
 * Overclocks GT 5.09.54.183 grants (OverclockCalculator): ULV recipes count as LV, the recipe tier uses the total
 * EU/t, and the overclocked EU/t may not exceed the machine's voltage x amperage.
 */
export function overclockCount(recipeEut: number, machineTier: number, amperage: number): number {
  const byTier = machineTier - Math.max(1, tierForEut(recipeEut));
  let byPower = 0;
  const budget = V[machineTier] * Math.max(1, amperage);
  for (let e = Math.max(recipeEut, 32) * 4; e <= budget; e *= 4) byPower++;
  return Math.max(0, Math.min(byTier, byPower));
}

export function nodeRates(node: ChainNode, db: RecipeDb): NodeRates {
  if (node.kind === 'generator') {
    const mapIndex = db.mapIndexById(node.fuelMap);
    if (mapIndex === undefined) return invalid('missing generator recipe map');
    const machine = db.map(mapIndex).machines.find((m) => m.mID === node.machineMID);
    if (!machine) return invalid('machine cannot burn this fuel');
    if (!machine.generator) return invalid('re-dump to enable generators');
    const fuel = db.fuelsFor(mapIndex).find((f) => f.key === node.fuelKey);
    if (!fuel) return invalid('not a fuel for this generator');
    const eut = machine.generator.euOut * machine.generator.ampsOut;
    const perMachine = new Map<ResourceKey, number>();
    add(perMachine, EU, eut);
    // GT: EU from fluid = (long) value * efficiency * litres / 100, so EU per litre rounds down.
    const euPerLitre = Math.floor((fuel.euPerLitre * machine.generator.efficiency) / 100);
    if (euPerLitre <= 0) return invalid('fuel too weak for this generator');
    add(perMachine, fuel.key, -(eut * 20) / euPerLitre);
    return { valid: true, perMachine, eut, duration: 1, approximate: machine.multiblock };
  }

  const recipe = db.bySignature(node.recipeSig);
  if (!recipe) return invalid('missing recipe');
  const map = db.map(recipe.map);
  const machine = map.machines.find((m) => m.mID === node.machineMID);
  if (!machine) return invalid('machine cannot run this recipe');

  const eutPerAmp = recipe.eut / Math.max(1, map.amperage);
  const mTier = machineTier(machine);
  const voltage = machine.voltage ?? (mTier !== undefined ? V[mTier] : undefined);
  if (voltage !== undefined && voltage < eutPerAmp) return invalid('machine tier too low');

  const overclocks = node.overclock && mTier !== undefined ? overclockCount(recipe.eut, mTier, map.amperage) : 0;
  const { eut, duration } = overclock(recipe.eut, Math.max(1, recipe.duration), overclocks);
  const perSecond = 20 / duration;
  const perMachine = new Map<ResourceKey, number>();
  for (const s of recipe.inputs) if (s.consumed !== false) add(perMachine, s.key, -s.amount * perSecond);
  for (const s of recipe.outputs) add(perMachine, s.key, s.amount * (s.chance ?? 1) * perSecond);
  add(perMachine, EU, -eut);
  return { valid: true, perMachine, eut, duration, approximate: machine.multiblock || voltage === undefined };
}
