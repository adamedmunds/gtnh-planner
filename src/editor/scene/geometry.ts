import type { Vec3 } from '../../model/types';

export interface Box { center: Vec3; size: Vec3 }

const AXIS_DIRS: readonly [number, number][] = [
  [1, -1], [1, 1], [2, -1], [2, 1], [0, -1], [0, 1], // [axis, sign] per GT side
];

/** Centre cube plus one arm per connected side, in unit-cell coordinates. */
export function conduitBoxes(thickness: number, mask: number): Box[] {
  const t = thickness;
  const boxes: Box[] = [{ center: [0.5, 0.5, 0.5], size: [t, t, t] }];
  const arm = (1 - t) / 2;
  AXIS_DIRS.forEach(([axis, sign], side) => {
    if (!(mask & (1 << side))) return;
    const center: [number, number, number] = [0.5, 0.5, 0.5];
    const size: [number, number, number] = [t, t, t];
    center[axis] = 0.5 + sign * (t / 2 + arm / 2);
    size[axis] = arm;
    boxes.push({ center, size });
  });
  return boxes;
}

export function sideFromNormal(n: Vec3): number {
  const idx = AXIS_DIRS.findIndex(([axis, sign]) => Math.round(n[axis]) === sign && Math.abs(n[axis]) > 0.9);
  return idx;
}

export const isClick = (delta: number) => delta <= 4;

/** GT side shown on each three.js BoxGeometry material slot (+x, -x, +y, -y, +z, -z). */
export const FACE_ORDER: readonly number[] = [5, 4, 1, 0, 3, 2];
