import {
  billOfMaterials, nextFacing, placeBlock, placementFacing, removeBlock, rotateBlock, toBlockMap, toggleSide,
} from './editing';
import { computeConnections } from './connections';
import { posKey } from './directions';
import type { PlacedBlock } from './types';

const EAST = 1 << 5, WEST = 1 << 4;

test('placeBlock adds to an empty cell and ignores an occupied one', () => {
  const m0 = toBlockMap([]);
  const m1 = placeBlock(m0, { pos: [0, 0, 0], key: 'distillery_lv', facing: 3 });
  expect(m1.size).toBe(1);
  expect(m0.size).toBe(0);
  const m2 = placeBlock(m1, { pos: [0, 0, 0], key: 'tin_cable_1x' });
  expect(m2).toBe(m1);
  expect(m2.get('0,0,0')!.key).toBe('distillery_lv');
});

test('removeBlock removes, and is a no-op on empty cells', () => {
  const m1 = toBlockMap([{ pos: [1, 2, 3], key: 'distillery_lv' }]);
  expect(removeBlock(m1, [1, 2, 3]).size).toBe(0);
  expect(removeBlock(m1, [9, 9, 9])).toBe(m1);
});

test('nextFacing cycles N→E→S→W, optionally through up/down', () => {
  expect([2, 5, 3, 4].map((f) => nextFacing(f as 2, false))).toEqual([5, 3, 4, 2]);
  expect(nextFacing(undefined, false)).toBe(4); // default south → west
  expect(nextFacing(4, true)).toBe(1);
  expect(nextFacing(1, true)).toBe(0);
  expect(nextFacing(0, true)).toBe(2);
  expect(nextFacing(0, false)).toBe(2); // vertical facing snaps back to the horizontal cycle
});

test('rotateBlock rotates machines only', () => {
  const m = toBlockMap([
    { pos: [0, 0, 0], key: 'distillery_lv', facing: 3 },
    { pos: [1, 0, 0], key: 'tin_cable_1x' },
  ]);
  expect(rotateBlock(m, [0, 0, 0], false).get('0,0,0')!.facing).toBe(4);
  expect(rotateBlock(m, [1, 0, 0], false)).toBe(m);
  expect(rotateBlock(m, [5, 5, 5], false)).toBe(m);
});

test('toggleSide flips a connected side off and an unconnected side on, for conduits only', () => {
  const m = toBlockMap([
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'tin_cable_1x' },
    { pos: [0, 1, 0], key: 'distillery_lv' },
  ]);
  const off = toggleSide(m, [0, 0, 0], 5);
  expect(computeConnections([...off.values()]).get(posKey([0, 0, 0]))! & EAST).toBe(0);
  const backOn = toggleSide(off, [0, 0, 0], 5);
  expect(computeConnections([...backOn.values()]).get(posKey([0, 0, 0]))! & EAST).toBe(EAST);
  expect(backOn.get('0,0,0')!.manualMask).toBeUndefined(); // overrides cancelled out
  const west = toggleSide(m, [0, 0, 0], 4);
  expect(computeConnections([...west.values()]).get(posKey([0, 0, 0]))! & WEST).toBe(WEST);
  expect(toggleSide(m, [0, 1, 0], 2)).toBe(m); // machine: no-op
});

test('placementFacing: horizontal faces keep their direction, top/bottom faces face the camera', () => {
  expect(placementFacing(3, [0, -1, -1])).toBe(3);
  expect(placementFacing(4, [0, -1, -1])).toBe(4);
  expect(placementFacing(1, [0, -0.7, -0.7])).toBe(3); // camera looks north → front faces south
  expect(placementFacing(1, [0.9, -0.3, 0.1])).toBe(4); // camera looks east → front faces west
  expect(placementFacing(0, [-0.9, -0.3, 0.1])).toBe(5);
  expect(placementFacing(1, [0.1, -0.5, 0.8])).toBe(2);
});

test('billOfMaterials counts by catalog entry, skips unknown keys, groups machines first', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'distillery_lv' },
    { pos: [2, 0, 0], key: 'distillery_lv' },
    { pos: [3, 0, 0], key: 'removed_thing' },
    { pos: [4, 0, 0], key: 'transformer_mv_lv' },
  ];
  expect(billOfMaterials(blocks)).toEqual([
    { key: 'distillery_lv', name: 'LV Distillery', group: 'Machines', count: 2 },
    { key: 'transformer_mv_lv', name: 'MV→LV Transformer', group: 'Power', count: 1 },
    { key: 'tin_cable_1x', name: '1x Tin Cable', group: 'Cables', count: 1 },
  ]);
});

test("toggleSide turning a side on also clears the neighbour's opposing forced-off override", () => {
  let m = toBlockMap([
    { pos: [0, 0, 0], key: 'bronze_pipe_normal' },
    { pos: [1, 0, 0], key: 'bronze_pipe_normal' },
  ]);
  m = toggleSide(m, [0, 0, 0], 5); // A east off (both pipes disconnect)
  m = toggleSide(m, [1, 0, 0], 4); // B west on → must reconnect both
  const c = computeConnections([...m.values()]);
  expect(c.get(posKey([0, 0, 0]))! & EAST).toBe(EAST);
  expect(c.get(posKey([1, 0, 0]))! & WEST).toBe(WEST);
});
