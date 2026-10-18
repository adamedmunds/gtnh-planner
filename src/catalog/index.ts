import { CATALOG_ENTRIES } from './entries';
import type { Catalog, CatalogEntry } from './types';

export * from './types';
export { CATALOG_ENTRIES };

export const CATALOG: Catalog = new Map(CATALOG_ENTRIES.map((e) => [e.key, e]));

export function getEntry(key: string, catalog: Catalog = CATALOG): CatalogEntry | undefined {
  return catalog.get(key);
}
