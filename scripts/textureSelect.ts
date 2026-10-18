import type { CatalogEntry } from '../src/catalog';

export const JAR_TEXTURE_ROOT = 'assets/gregtech/textures/';

export function wantedTexturePaths(entries: readonly CatalogEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const p of Object.values(e.textures)) if (p) set.add(p);
  return [...set].sort();
}

export function selectTextures(
  files: Record<string, Uint8Array>,
  wanted: readonly string[],
): { files: Record<string, Uint8Array>; missing: string[] } {
  const out: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  for (const rel of wanted) {
    const data = files[JAR_TEXTURE_ROOT + rel];
    if (!data) {
      missing.push(rel);
      continue;
    }
    out[rel] = data;
    const meta = files[`${JAR_TEXTURE_ROOT}${rel}.mcmeta`];
    if (meta) out[`${rel}.mcmeta`] = meta;
  }
  return { files: out, missing };
}
