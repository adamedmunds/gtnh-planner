import { CONTROLLER_TEXTURE_PATHS, type CatalogEntry } from '../src/catalog';

export const JAR_TEXTURE_ROOT = 'assets/gregtech/textures/';

/** Which jar a catalog texture comes from, and its path in it: `storagedrawers/` and `minecraft/` ones, else GregTech's. */
export function textureSource(rel: string): { jar: 'gregtech' | 'storagedrawers' | 'minecraft'; path: string } {
  for (const jar of ['storagedrawers', 'minecraft'] as const) {
    if (rel.startsWith(`${jar}/`)) return { jar, path: `assets/${jar}/textures/${rel.slice(jar.length + 1)}` };
  }
  return { jar: 'gregtech', path: JAR_TEXTURE_ROOT + rel };
}

export function wantedTexturePaths(entries: readonly CatalogEntry[]): string[] {
  const set = new Set<string>(CONTROLLER_TEXTURE_PATHS);
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
    const { path } = textureSource(rel);
    const data = files[path];
    if (!data) {
      missing.push(rel);
      continue;
    }
    out[rel] = data;
    const meta = files[`${path}.mcmeta`];
    if (meta) out[`${rel}.mcmeta`] = meta;
  }
  return { files: out, missing };
}
