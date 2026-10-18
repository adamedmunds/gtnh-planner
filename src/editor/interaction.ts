import { CATALOG, type Catalog } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import type { BlockMap } from '../model/editing';
import type { PlacedBlock, Vec3 } from '../model/types';

/** What the pointer hit: a block cell, the face normal as a GT side, and for pipe arms the arm's direction. */
export interface Hit { pos: Vec3; side: number; arm?: number }

/**
 * Which cable/pipe side a Shift+click should toggle. The face toward a connected neighbour is buried inside the
 * arm, so clicking an arm toggles the arm's own direction; clicking a machine face toggles the pipe attached
 * to that face. Returns null when there is nothing to toggle.
 */
export function shiftClickTarget(blocks: BlockMap, hit: Hit, catalog: Catalog = CATALOG): { pos: Vec3; side: number } | null {
  const block = blocks.get(posKey(hit.pos));
  const kind = block && catalog.get(block.key)?.kind;
  if (!kind) return null;
  if (kind !== 'machine') return { pos: hit.pos, side: hit.arm ?? hit.side };
  const neighbour = addVec(hit.pos, DIRS[hit.side]);
  const nb = blocks.get(posKey(neighbour));
  const nbKind = nb && catalog.get(nb.key)?.kind;
  return nbKind && nbKind !== 'machine' ? { pos: neighbour, side: OPPOSITE[hit.side] } : null;
}

/** Camera target and position that fit the whole build in view, or null for an empty build. */
export function frameFor(blocks: BlockMap): { target: Vec3; position: Vec3 } | null {
  if (blocks.size === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of blocks.values()) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], b.pos[a]);
      max[a] = Math.max(max[a], b.pos[a] + 1);
    }
  }
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const distance = extent * 1.1 + 6;
  const dir = [0.55, 0.5, 0.67];
  const norm = Math.hypot(dir[0], dir[1], dir[2]);
  return {
    target,
    position: [target[0] + (dir[0] / norm) * distance, target[1] + (dir[1] / norm) * distance, target[2] + (dir[2] / norm) * distance],
  };
}

/** Blocks may not go below the ground, or above the layer cut-off (they would be placed invisibly). */
export function placementAllowed(pos: Vec3, layer: number | null): { ok: true } | { ok: false; reason: string } {
  if (pos[1] < 0) return { ok: false, reason: 'Blocks can only be placed at ground level (y = 0) or above.' };
  if (layer !== null && pos[1] > layer) {
    return { ok: false, reason: `That spot is above the layer cut-off (y ≤ ${layer}); raise the layer slider to build higher.` };
  }
  return { ok: true };
}

interface HoverLike { pos: readonly number[]; side: number; ground?: boolean; arm?: number }

export function sameHover(a: HoverLike | null, b: HoverLike | null): boolean {
  if (a === null || b === null) return a === b;
  return a.side === b.side && !!a.ground === !!b.ground && a.arm === b.arm &&
    a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2];
}

export function unknownKeys(blocks: Iterable<PlacedBlock>, catalog: Catalog = CATALOG): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of blocks) if (!catalog.has(b.key)) counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count }));
}
