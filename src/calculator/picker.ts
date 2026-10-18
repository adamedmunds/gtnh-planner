import type { Chain } from '../calc/chain';
import { generatorOptions } from '../calc/machines';
import { suggestFor, usesFor, type Suggestion } from '../calc/suggest';
import { tierName } from '../calc/tiers';
import type { RecipeDb } from '../recipes/db';
import type { Fuel, MachineRef, Recipe, ResourceKey, Stack } from '../recipes/types';
import { producedKeys, resourceInfo } from './graphModel';

export type PickerMode = { kind: 'makes'; key: ResourceKey } | { kind: 'uses'; key: ResourceKey } | { kind: 'power' };

/** One choice in the picker: a recipe, or a fuel burned in a generator. */
export interface PickerRow {
  id: string;
  recipe?: Recipe;
  fuel?: Fuel;
  machine: MachineRef;
  tier?: string;
  /** Used up. */
  consumed: Stack[];
  /** Needed but not used up (programmed circuits, molds). */
  kept: Stack[];
  outputs: Stack[];
  seconds: number;
  eut: number;
  /** Why it fits this line, when it does. */
  reason?: string;
}

const names = (keys: ResourceKey[], db: RecipeDb) => keys.map((k) => resourceInfo(k, db).name).join(' and ');

export function pickerTitle(mode: PickerMode, db: RecipeDb): string {
  if (mode.kind === 'power') return 'Power it with a generator';
  const name = resourceInfo(mode.key, db).name;
  return mode.kind === 'makes' ? `What makes ${name}?` : `What uses ${name}?`;
}

function recipeRow(s: Suggestion, made: Set<ResourceKey>, skip: ResourceKey | undefined, db: RecipeDb): PickerRow {
  const { recipe, machine } = s;
  const consumed = recipe.inputs.filter((x) => x.consumed !== false);
  const already = consumed.map((x) => x.key).filter((k) => k !== skip && made.has(k));
  return {
    id: `r${recipe.id}`,
    recipe,
    machine,
    ...(tierName(machine) ? { tier: tierName(machine) } : {}),
    consumed,
    kept: recipe.inputs.filter((x) => x.consumed === false),
    outputs: recipe.outputs,
    seconds: recipe.duration / 20,
    eut: recipe.eut,
    ...(already.length ? { reason: `uses ${names(already, db)} you already make` } : {}),
  };
}

/** The picker's choices, best first. */
export function pickerRows(mode: PickerMode, chain: Chain, db: RecipeDb, limit: number): PickerRow[] {
  const made = producedKeys(chain, db);
  if (mode.kind === 'makes') return suggestFor(mode.key, chain, db, limit).map((s) => recipeRow(s, made, undefined, db));
  if (mode.kind === 'uses') return usesFor(mode.key, chain, db, limit).map((s) => recipeRow(s, made, mode.key, db));

  const rows: PickerRow[] = [];
  for (const fuel of db.allFuels()) {
    const machine = generatorOptions(fuel.map, db)[0];
    if (!machine) continue;
    const ours = made.has(fuel.key);
    rows.push({
      id: `f${fuel.map}:${fuel.key}`,
      fuel,
      machine,
      ...(tierName(machine) ? { tier: tierName(machine) } : {}),
      consumed: [{ key: fuel.key, amount: 0 }],
      kept: [],
      outputs: [],
      seconds: 0,
      eut: machine.generator ? machine.generator.euOut * machine.generator.ampsOut : 0,
      ...(ours ? { reason: `burns ${resourceInfo(fuel.key, db).name} the line makes` } : {}),
    });
  }
  rows.sort((a, b) => Number(!!b.reason) - Number(!!a.reason));
  return rows.slice(0, limit);
}

/** Rows whose items, machine or recipe map mention `text` (case-insensitive). */
export function filterRows(rows: PickerRow[], text: string, db: RecipeDb): PickerRow[] {
  const q = text.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const map = r.recipe ? db.map(r.recipe.map).name : r.fuel ? db.map(r.fuel.map).name : '';
    const words = [map, r.machine.name, ...[...r.consumed, ...r.kept, ...r.outputs].map((s) => resourceInfo(s.key, db).name)];
    return words.some((w) => w.toLowerCase().includes(q));
  });
}
