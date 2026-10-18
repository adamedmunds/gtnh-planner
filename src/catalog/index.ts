import { CATALOG_ENTRIES } from './entries';
import type { Catalog, CatalogEntry } from './types';

export * from './types';
export { CATALOG_ENTRIES };

/** GregTech version the block catalog's machine IDs were taken from. */
export const CATALOG_GREGTECH = '5.09.54.183';

export const CATALOG: Catalog = new Map(CATALOG_ENTRIES.map((e) => [e.key, e]));

export function getEntry(key: string, catalog: Catalog = CATALOG): CatalogEntry | undefined {
  return catalog.get(key);
}
