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
