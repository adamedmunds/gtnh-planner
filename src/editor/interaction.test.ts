import { frameFor, shiftClickTarget } from './interaction';
import { toBlockMap } from '../model/editing';

const blocks = toBlockMap([
  { pos: [0, 0, 0], key: 'distillery_lv', facing: 3 },
  { pos: [0, 1, 0], key: 'bronze_pipe_normal' },
]);

test('shift+click on a pipe arm toggles the direction the arm points, not the hit face', () => {
  expect(shiftClickTarget(blocks, { pos: [0, 1, 0], side: 4, arm: 0 })).toEqual({ pos: [0, 1, 0], side: 0 });
});

test('shift+click on the centre of a pipe toggles the hit face', () => {
  expect(shiftClickTarget(blocks, { pos: [0, 1, 0], side: 5 })).toEqual({ pos: [0, 1, 0], side: 5 });
});

test('shift+click on a machine face toggles the pipe attached to that face', () => {
  expect(shiftClickTarget(blocks, { pos: [0, 0, 0], side: 1 })).toEqual({ pos: [0, 1, 0], side: 0 });
});

test('shift+click on a machine face with no pipe there does nothing', () => {
  expect(shiftClickTarget(blocks, { pos: [0, 0, 0], side: 3 })).toBeNull();
});

test('frameFor centres the camera target on the build and backs off by its size', () => {
  const f = frameFor(toBlockMap([
    { pos: [-8, 0, -1], key: 'distillery_lv' },
    { pos: [19, 3, 1], key: 'distillery_lv' },
  ]))!;
  expect(f.target).toEqual([6, 2, 0.5]);
  const dist = Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2]);
  expect(dist).toBeGreaterThan(28);
  expect(frameFor(toBlockMap([]))).toBeNull();
});
