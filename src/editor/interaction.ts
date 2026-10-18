import { CATALOG, type Catalog } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import type { BlockMap } from '../model/editing';
import type { Vec3 } from '../model/types';

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
