import type { ResourceKey } from './types';

/** `icons.json` from `/gtnhplanner icons`: sprite sheets of square icons, indexed by resource key. */
export interface IconIndex {
  size: number;
  perRow: number;
  sheets: string[];
  /** key → [sheet, column, row] */
  icons: Record<ResourceKey, [number, number, number]>;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function parseIconIndex(raw: unknown): IconIndex | undefined {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || r.format !== 1 || !isInt(r.size) || !isInt(r.perRow) || r.perRow === 0) return undefined;
  if (!Array.isArray(r.sheets) || !r.sheets.every((s) => typeof s === 'string')) return undefined;
  if (!r.icons || typeof r.icons !== 'object') return undefined;
  const sheets = r.sheets as string[];
  const icons: IconIndex['icons'] = {};
  for (const [key, v] of Object.entries(r.icons as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length === 3 && v.every(isInt) && v[0] < sheets.length) icons[key] = [v[0], v[1], v[2]];
  }
  return { size: r.size, perRow: r.perRow, sheets, icons };
}

export async function loadIconIndex(url: string, fetchFn: typeof fetch = fetch): Promise<IconIndex | undefined> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return undefined;
    return parseIconIndex(JSON.parse(await res.text()));
  } catch {
    return undefined;
  }
}

/** CSS for drawing `key`'s icon at `px` pixels from its sprite sheet under `base`; undefined when it has none. */
export function iconStyle(index: IconIndex | undefined, key: ResourceKey, px: number, base: string) {
  const at = index?.icons[key];
  if (!index || !at) return undefined;
  const [sheet, col, row] = at;
  const sheetPx = index.perRow * px;
  return {
    backgroundImage: `url(${base}${index.sheets[sheet]})`,
    backgroundPosition: `${-col * px}px ${-row * px}px`,
    backgroundSize: `${sheetPx}px ${sheetPx}px`,
  };
}

/** A stable colour for an icon placeholder. */
export function fallbackColour(key: ResourceKey): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 45%)`;
}
