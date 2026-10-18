import { gunzip } from 'fflate';
import { CATALOG_GREGTECH } from '../catalog';
import { RecipeDb } from './db';
import type { AppRecipeData } from './types';

export type RecipeLoad = { status: 'ok'; db: RecipeDb; warning?: string } | { status: 'missing' } | { status: 'error'; message: string };

const gunzipAsync = (bytes: Uint8Array) =>
  new Promise<Uint8Array>((resolve, reject) => gunzip(bytes, (err, out) => (err ? reject(err) : resolve(out))));

function isAppData(x: unknown): x is AppRecipeData {
  const d = x as AppRecipeData;
  return !!d && typeof d === 'object' && d.format === 1 && Array.isArray(d.resources) && Array.isArray(d.maps) &&
    Array.isArray(d.recipes) && Array.isArray(d.fuels);
}

/**
 * Fetches the app's recipe file and indexes it. Gunzip runs in fflate's worker; parsing and indexing run here.
 * The file may arrive already decoded (a server sending Content-Encoding: gzip), so gzip is detected by its magic bytes.
 */
export async function loadRecipeDb(url: string, fetchFn: typeof fetch = fetch): Promise<RecipeLoad> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return { status: 'missing' };
    let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzipAsync(bytes);
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith('{')) return { status: 'missing' }; // e.g. the dev server's index.html fallback
    const data: unknown = JSON.parse(text);
    if (!isAppData(data)) return { status: 'error', message: 'This is not planner recipe data. Re-run npm run recipes.' };
    const db = new RecipeDb(data);
    const warning = data.gregtech !== CATALOG_GREGTECH
      ? `Recipes are from GregTech ${data.gregtech}; the block catalog is for ${CATALOG_GREGTECH}. Numbers may be off.`
      : undefined;
    return warning ? { status: 'ok', db, warning } : { status: 'ok', db };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}
