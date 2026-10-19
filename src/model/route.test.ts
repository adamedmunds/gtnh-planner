import { routeNetwork } from './route';
import { posKey } from './directions';
import type { Vec3 } from './types';

const keys = (cells: readonly Vec3[]) => cells.map(posKey).sort();
const bounds = { min: [-5, 0, -5] as Vec3, max: [5, 3, 5] as Vec3 };

test('connects two single-candidate terminals with a straight run', () => {
  const r = routeNetwork({ terminals: [[[0, 0, 0]], [[3, 0, 0]]], blocked: new Set(), bounds });
  expect(keys(r.cells)).toEqual(keys([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]));
  expect(r.chosen.map(posKey)).toEqual(['0,0,0', '3,0,0']);
});

test('picks the closest candidate of a terminal', () => {
  const r = routeNetwork({ terminals: [[[0, 0, 0]], [[4, 0, 0], [1, 0, 0]]], blocked: new Set(), bounds });
  expect(keys(r.cells)).toEqual(keys([[0, 0, 0], [1, 0, 0]]));
  expect(posKey(r.chosen[1])).toBe('1,0,0');
});

test('routes around blocked cells', () => {
  const r = routeNetwork({
    terminals: [[[0, 0, 0]], [[2, 0, 0]]],
    blocked: new Set([posKey([1, 0, 0])]),
    bounds,
  });
  expect(r.cells.some((c) => posKey(c) === '1,0,0')).toBe(false);
  expect(r.cells).toHaveLength(5);
});

test('shares pipe between terminals (Steiner-style), not one path per terminal', () => {
  // Three terminals on a line: the middle one should reuse the run, total 5 cells.
  const r = routeNetwork({ terminals: [[[0, 0, 0]], [[4, 0, 0]], [[2, 0, 0]]], blocked: new Set(), bounds });
  expect(r.cells).toHaveLength(5);
});

test('prefers cells that are not penalised when an equally short route exists', () => {
  const r = routeNetwork({
    terminals: [[[0, 0, 0]], [[2, 0, 1]]],
    blocked: new Set(),
    avoid: new Set([posKey([1, 0, 0]), posKey([2, 0, 0])]),
    bounds,
  });
  expect(r.cells.map(posKey)).not.toContain('1,0,0');
  expect(r.cells).toHaveLength(4);
});

test('throws when a terminal cannot be reached', () => {
  const walls = new Set<string>();
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) walls.add(posKey(d));
  expect(() =>
    routeNetwork({ terminals: [[[0, 0, 0]], [[3, 0, 0]]], blocked: walls, bounds }),
  ).toThrow(/unreachable/);
});

/** Direction changes along a single path, walked from `start`. */
function bends(cells: readonly Vec3[], start: Vec3): number {
  const left = new Map(cells.map((c) => [posKey(c), c]));
  let cur = start;
  left.delete(posKey(cur));
  let dir = '';
  let count = 0;
  while (left.size) {
    const next = [...left.values()].find((c) => Math.abs(c[0] - cur[0]) + Math.abs(c[1] - cur[1]) + Math.abs(c[2] - cur[2]) === 1);
    if (!next) break;
    const d = `${next[0] - cur[0]},${next[1] - cur[1]},${next[2] - cur[2]}`;
    if (dir && d !== dir) count++;
    dir = d;
    left.delete(posKey(next));
    cur = next;
  }
  return count;
}

test('canStep limits moves: off-x steps only at x = 4', () => {
  const r = routeNetwork({
    terminals: [[[0, 0, 0]], [[4, 0, 2]]],
    blocked: new Set(),
    bounds: { min: [0, 0, 0], max: [4, 0, 2] },
    canStep: (from, to) => from[2] === to[2] || from[0] === 4,
  });
  for (const c of r.cells) if (c[2] !== 0) expect(c[0]).toBe(4);
});

test('bendPenalty: a long open diagonal takes one bend, not a staircase', () => {
  const r = routeNetwork({
    terminals: [[[0, 0, 0]], [[6, 0, 6]]],
    blocked: new Set(),
    bounds: { min: [0, 0, 0], max: [6, 0, 6] },
    bendPenalty: 3,
  });
  expect(r.cells).toHaveLength(13);
  expect(bends(r.cells, [0, 0, 0])).toBe(1);
});

test('bendPenalty still takes a detour around a wall', () => {
  const blocked = new Set([posKey([2, 0, 0]), posKey([2, 0, 1])]);
  const r = routeNetwork({ terminals: [[[0, 0, 0]], [[4, 0, 0]]], blocked, bounds: { min: [0, 0, 0], max: [4, 0, 3] }, bendPenalty: 3 });
  expect(r.cells.some((c) => blocked.has(posKey(c)))).toBe(false);
  expect(bends(r.cells, [0, 0, 0])).toBe(2); // up the side, along, back down
});
