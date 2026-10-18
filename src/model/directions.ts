import type { Facing, Vec3 } from './types';

/** Unit vector for each GT side, indexed by Facing. */
export const DIRS: readonly Vec3[] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

export const OPPOSITE: readonly Facing[] = [1, 0, 3, 2, 5, 4];

export function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
