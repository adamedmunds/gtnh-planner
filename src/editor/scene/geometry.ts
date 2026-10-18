import type { Vec3 } from '../../model/types';

/** `arm` is the GT side an arm box points toward; absent for the centre box. */
export interface Box { center: Vec3; size: Vec3; arm?: number }

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
    boxes.push({ center, size, arm: side });
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

const axisOf = (side: number) => AXIS_DIRS[side][0];

const OPPOSITE_SIDE = [1, 0, 3, 2, 5, 4];

/**
 * Which texture each face of a conduit box shows, in FACE_ORDER (BoxGeometry material order). Arms show the
 * pipe end across their axis and the pipe surface along it. The centre shows the surface, except an open end
 * where a straight run stops (its only connection is on the opposite side).
 */
export function faceKinds(box: Pick<Box, 'arm'>, mask: number): ('side' | 'end')[] {
  return FACE_ORDER.map((s) => {
    if (box.arm !== undefined) return axisOf(s) === axisOf(box.arm) ? 'end' : 'side';
    const stops = mask === 1 << OPPOSITE_SIDE[s]; // the run's only connection is straight behind this face
    return stops ? 'end' : 'side';
  });
}
