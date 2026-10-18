import type { AppRecipeData, Fuel, Recipe, RecipeMapInfo, Resource, ResourceKey } from './types';

const stackPart = (stacks: { key: string; amount: number; chance?: number }[]) =>
  stacks.map((s) => `${s.key}*${s.amount}${s.chance !== undefined && s.chance !== 1 ? `~${s.chance}` : ''}`).sort().join(',');

/**
 * Content-based recipe identity, stable across re-dumps: map id, EU/t, duration, special value, sorted inputs and
 * sorted outputs (with chances). Same items at a different speed or power are different recipes.
 */
export function recipeSignature(r: Recipe, db: RecipeDb): string {
  return `${db.map(r.map).id}|${r.eut}|${r.duration}|${r.specialValue}|${stackPart(r.inputs)}|${stackPart(r.outputs)}`;
}

/** Read-only recipe database with the lookups the calculator needs. */
export class RecipeDb {
  readonly gregtech: string;
  readonly dumpFormat: 1 | 2;
  private readonly resources = new Map<ResourceKey, Resource>();
  private readonly recipes: Recipe[];
  private readonly maps: RecipeMapInfo[];
  private readonly producers = new Map<ResourceKey, Recipe[]>();
  private readonly consumers = new Map<ResourceKey, Recipe[]>();
  private readonly fuels = new Map<number, Fuel[]>();
  private readonly fuelUses = new Map<ResourceKey, Fuel[]>();
  private readonly mapIndex = new Map<string, number>();
  private signatures?: Map<string, Recipe>;
  private readonly searchable: { lower: string; resource: Resource }[];

  constructor(data: AppRecipeData) {
    this.gregtech = data.gregtech;
    this.dumpFormat = data.dumpFormat;
    this.recipes = data.recipes;
    this.maps = data.maps;
    for (const r of data.resources) this.resources.set(r.key, r);
    for (const m of data.maps) this.mapIndex.set(m.id, m.index);
    const add = (index: Map<ResourceKey, Recipe[]>, key: ResourceKey, r: Recipe) => {
      const list = index.get(key);
      if (list) {
        if (list[list.length - 1] !== r) list.push(r);
      } else index.set(key, [r]);
    };
    for (const r of data.recipes) {
      for (const s of r.outputs) add(this.producers, s.key, r);
      for (const s of r.inputs) if (s.consumed !== false) add(this.consumers, s.key, r);
    }
    for (const f of data.fuels) {
      const list = this.fuels.get(f.map) ?? [];
      list.push(f);
      this.fuels.set(f.map, list);
      const uses = this.fuelUses.get(f.key) ?? [];
      uses.push(f);
      this.fuelUses.set(f.key, uses);
    }
    this.searchable = data.resources.map((resource) => ({ lower: resource.name.toLowerCase(), resource }));
  }

  resource(key: ResourceKey): Resource | undefined {
    return this.resources.get(key);
  }

  recipe(id: number): Recipe | undefined {
    return this.recipes[id];
  }

  map(index: number): RecipeMapInfo {
    return this.maps[index];
  }

  mapIndexById(id: string): number | undefined {
    return this.mapIndex.get(id);
  }

  producersOf(key: ResourceKey): Recipe[] {
    return this.producers.get(key) ?? [];
  }

  consumersOf(key: ResourceKey): Recipe[] {
    return this.consumers.get(key) ?? [];
  }

  fuelsFor(mapIndex: number): Fuel[] {
    return this.fuels.get(mapIndex) ?? [];
  }

  /** Every generator map that burns this resource, in map order. */
  fuelUsesOf(key: ResourceKey): Fuel[] {
    return this.fuelUses.get(key) ?? [];
  }

  bySignature(sig: string): Recipe | undefined {
    if (!this.signatures) {
      this.signatures = new Map();
      for (const r of this.recipes) this.signatures.set(recipeSignature(r, this), r);
    }
    return this.signatures.get(sig);
  }

  /** Name search: exact, then prefix, then word-prefix, then substring; shorter names first within a rank. */
  search(text: string, limit = 50): Resource[] {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const ranked: { rank: number; resource: Resource; len: number }[] = [];
    for (const { lower, resource } of this.searchable) {
      const at = lower.indexOf(q);
      if (at < 0) continue;
      const rank = lower === q ? 0 : at === 0 ? 1 : lower[at - 1] === ' ' ? 2 : 3;
      ranked.push({ rank, resource, len: lower.length });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.len - b.len || a.resource.name.localeCompare(b.resource.name));
    return ranked.slice(0, limit).map((x) => x.resource);
  }
}
