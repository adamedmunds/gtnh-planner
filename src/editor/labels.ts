import { computeConnections } from '../model/connections';
import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock, Vec3 } from '../model/types';

/**
 * Where to float "what's in this pipe" icons: on straight runs along the line (≥ 3 pipes of one network), about once
 * per slice length, so a long line shows a label per lane per slice and short branches show none.
 */
export function labelSpots(build: Build): { net: string; pos: Vec3 }[] {
  if (!build.networks?.length) return [];
  const spacing = Math.max(build.generated?.sliceLength ?? 8, 6);
  const runs = new Map<string, number[]>(); // `${net}|${y}|${z}` -> x of every cell
  for (const b of build.blocks) {
    if (!b.net) continue;
    const k = `${b.net}|${b.pos[1]}|${b.pos[2]}`;
    runs.set(k, [...(runs.get(k) ?? []), b.pos[0]]);
  }
  const spots: { net: string; pos: Vec3 }[] = [];
  for (const [k, xs] of runs) {
    const [net, y, z] = k.split('|');
    xs.sort((a, b) => a - b);
    // Split into contiguous segments.
    let start = 0;
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === xs[i - 1] + 1) continue;
      const seg = xs.slice(start, i);
      start = i;
      if (seg.length < 3) continue;
      const first = seg[0];
      const last = seg[seg.length - 1];
      if (last - first + 1 <= spacing) {
        spots.push({ net, pos: [seg[Math.floor(seg.length / 2)], Number(y), Number(z)] });
        continue;
      }
      for (let x = first + Math.floor(spacing / 2); x <= last; x += spacing) spots.push({ net, pos: [x, Number(y), Number(z)] });
    }
  }
  return spots;
}

/** A network's pipes plus the blocks they connect to (machines, markers). */
export function networkMembers(blocks: readonly PlacedBlock[], net: string): Set<string> {
  const masks = computeConnections(blocks);
  const at = new Map(blocks.map((b) => [posKey(b.pos), b]));
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.net !== net) continue;
    out.add(posKey(b.pos));
    const mask = masks.get(posKey(b.pos)) ?? 0;
    DIRS.forEach((d, side) => {
      if (!(mask & (1 << side))) return;
      const n = at.get(posKey(addVec(b.pos, d)));
      if (n && !n.net) out.add(posKey(n.pos));
    });
  }
  return out;
}
