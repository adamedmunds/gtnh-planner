import { FACE_ORDER, conduitBoxes, faceKinds, isClick, sideFromNormal } from './geometry';

test('a conduit with no connections is a single centred cube', () => {
  expect(conduitBoxes(0.5, 0)).toEqual([{ center: [0.5, 0.5, 0.5], size: [0.5, 0.5, 0.5] }]);
});

test('each connected side adds an arm reaching the cell edge', () => {
  const boxes = conduitBoxes(0.5, 1 << 5); // east
  expect(boxes).toHaveLength(2);
  expect(boxes[1]).toEqual({ center: [0.875, 0.5, 0.5], size: [0.25, 0.5, 0.5], arm: 5 });
  const down = conduitBoxes(0.25, 1 << 0)[1];
  expect(down.center[1]).toBeCloseTo(0.1875);
  expect(down.size[1]).toBeCloseTo(0.375);
  expect(conduitBoxes(0.25, 63)).toHaveLength(7);
});

test('sideFromNormal maps axis normals to GT sides', () => {
  expect([[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]].map((n) => sideFromNormal(n as never))).toEqual([0, 1, 2, 3, 4, 5]);
  expect(sideFromNormal([0.7, 0.7, 0])).toBe(-1);
});

test('isClick treats small pointer movement as a click and larger as a drag', () => {
  expect(isClick(0)).toBe(true);
  expect(isClick(4)).toBe(true);
  expect(isClick(4.1)).toBe(false);
});

test('FACE_ORDER matches three.js BoxGeometry material order (+x, -x, +y, -y, +z, -z)', () => {
  expect(FACE_ORDER).toEqual([5, 4, 1, 0, 3, 2]);
});

test('faceKinds: arm boxes show the pipe end on faces across their axis, the length texture elsewhere', () => {
  // material order +x, -x, +y, -y, +z, -z
  expect(faceKinds({ arm: 5 }, 0)).toEqual(['end', 'end', 'side', 'side', 'side', 'side']);
  expect(faceKinds({ arm: 0 }, 0)).toEqual(['side', 'side', 'end', 'end', 'side', 'side']);
});

test('faceKinds: the centre box shows the pipe surface, with an end only where a run stops', () => {
  const eastWest = (1 << 5) | (1 << 4);
  expect(faceKinds({}, eastWest)).toEqual(['side', 'side', 'side', 'side', 'side', 'side']);
  // Connected east only: the run ends on the west face.
  expect(faceKinds({}, 1 << 5)).toEqual(['side', 'end', 'side', 'side', 'side', 'side']);
  expect(faceKinds({}, 0)).toEqual(['side', 'side', 'side', 'side', 'side', 'side']);
  // T-junction (east, west, north into a machine): no open ends.
  expect(faceKinds({}, (1 << 5) | (1 << 4) | (1 << 2))).toEqual(['side', 'side', 'side', 'side', 'side', 'side']);
});
