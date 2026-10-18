import { computeConnections } from './connections';
import { posKey } from './directions';
import type { PlacedBlock } from './types';

const DOWN = 1 << 0, UP = 1 << 1, NORTH = 1 << 2, SOUTH = 1 << 3, WEST = 1 << 4, EAST = 1 << 5;
const at = (m: Map<string, number>, x: number, y: number, z: number) => m.get(posKey([x, y, z]));

test('straight north-south run: middle piece has mConnections 12 (matches world save)', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, -1], key: 'bronze_pipe_normal' },
    { pos: [0, 0, 0], key: 'bronze_pipe_normal' },
    { pos: [0, 0, 1], key: 'bronze_pipe_normal' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(12);
  expect(at(m, 0, 0, 0)).toBe(NORTH | SOUTH);
  expect(at(m, 0, 0, -1)).toBe(SOUTH);
});

test('cable connects to an adjacent machine; machines get no entry', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'distillery_lv', facing: 3 },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(EAST);
  expect(at(m, 1, 0, 0)).toBeUndefined();
});

test('different materials of the same kind connect; different kinds do not', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'copper_cable_4x' },
    { pos: [0, 1, 0], key: 'bronze_pipe_small' },
    { pos: [0, -1, 0], key: 'tin_item_pipe_small' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(EAST);
  expect(at(m, 1, 0, 0)).toBe(WEST);
  expect(at(m, 0, 1, 0)).toBe(0);
  expect(at(m, 0, -1, 0)).toBe(0);
});

test('forcedOff on one side disconnects both pieces', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: 0, forcedOff: EAST } },
    { pos: [1, 0, 0], key: 'tin_cable_1x' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(0);
  expect(at(m, 1, 0, 0)).toBe(0);
});

test('forcedOn connects toward an empty side, and toward a neighbour that would not auto-connect', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'bronze_pipe_normal', manualMask: { forcedOn: UP | DOWN, forcedOff: 0 } },
  ];
  expect(at(computeConnections(blocks), 0, 0, 0)).toBe(UP | DOWN);
});

test('forcedOff wins over a neighbour forcedOn', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: 0, forcedOff: EAST } },
    { pos: [1, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: WEST, forcedOff: 0 } },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(0);
  expect(at(m, 1, 0, 0)).toBe(0);
});

test('unknown catalog keys are ignored (neither connected to nor given an entry)', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'removed_thing' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(0);
  expect(at(m, 1, 0, 0)).toBeUndefined();
});

test('a pipe next to a marker connects to it', () => {
  const masks = computeConnections([
    { pos: [0, 0, 0], key: 'marker_fluid_out' },
    { pos: [1, 0, 0], key: 'bronze_pipe_small' },
  ]);
  expect(masks.get(posKey([1, 0, 0]))).toBe(1 << 4);
});
