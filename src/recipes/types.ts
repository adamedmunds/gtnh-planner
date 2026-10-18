/** `item:<registryId>@<meta>`, `fluid:<fluidId>` or `eu`. */
export type ResourceKey = string;

export const EU: ResourceKey = 'eu';

export interface Resource {
  key: ResourceKey;
  name: string;
  kind: 'item' | 'fluid' | 'eu';
}

export interface Stack {
  key: ResourceKey;
  amount: number;
  /** Outputs only: 0..1. */
  chance?: number;
  /** Inputs only: false for non-consumed items (programmed circuits, molds). */
  consumed?: boolean;
}

export interface Recipe {
  id: number;
  map: number;
  eut: number;
  duration: number;
  specialValue: number;
  inputs: Stack[];
  outputs: Stack[];
}

export interface GeneratorStats {
  /** Percent, e.g. 95. */
  efficiency: number;
  /** EU/t per amp. */
  euOut: number;
  ampsOut: number;
}

export interface MachineRef {
  mID: number;
  name: string;
  tier?: number;
  multiblock: boolean;
  /** EU/t per amp the machine accepts (V[tier]); absent in format-1 dumps and for multiblocks. */
  voltage?: number;
  generator?: GeneratorStats;
}

export interface RecipeMapInfo {
  index: number;
  id: string;
  name: string;
  amperage: number;
  machines: MachineRef[];
}

/** A fluid a generator recipe map can burn, with its energy per litre before efficiency. */
export interface Fuel {
  map: number;
  key: ResourceKey;
  euPerLitre: number;
}

/** The app's recipe file (public/data/recipes.json.gz). */
export interface AppRecipeData {
  format: 1;
  gregtech: string;
  dumpFormat: 1 | 2;
  exportedAt: number;
  resources: Resource[];
  maps: RecipeMapInfo[];
  recipes: Recipe[];
  fuels: Fuel[];
  /** Items that hold a fluid (cells, buckets, capsules); absent in files imported before containers were kept. */
  containers?: { item: ResourceKey; fluid: ResourceKey; amount: number }[];
}
