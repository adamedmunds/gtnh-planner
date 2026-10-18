import { CATALOG_ENTRIES, generatedEntry } from './entries';
import type { Catalog, CatalogEntry, GeneratedMachine } from './types';

export * from './types';
export { CATALOG_ENTRIES };

/** GregTech version the block catalog's machine IDs were taken from. */
export const CATALOG_GREGTECH = '5.09.54.183';

const entries = new Map(CATALOG_ENTRIES.map((e) => [e.key, e]));
export const CATALOG: Catalog = entries;

/** Key for a recipe machine without a hand-made catalog entry. */
export const machineKey = (mID: number) => `gt_${mID}`;

/** Adds recipe machines (from a build or the Calculator) to the catalog; hand-made entries are never replaced. */
export function registerMachines(machines: readonly GeneratedMachine[]): void {
  for (const m of machines) {
    const existing = entries.get(m.key);
    if (!existing || existing.group === 'Recipe machines') entries.set(m.key, generatedEntry(m));
  }
}

export function getEntry(key: string, catalog: Catalog = CATALOG): CatalogEntry | undefined {
  return catalog.get(key);
}
