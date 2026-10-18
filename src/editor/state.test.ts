import { initialState, reducer, toBuild } from './state';

test('place uses the selected key; machines get the given facing (default south), conduits none', () => {
  let s = initialState();
  s = reducer(s, { type: 'place', pos: [0, 0, 0], facing: 4 });
  s = reducer(s, { type: 'select', key: 'tin_cable_1x' });
  s = reducer(s, { type: 'place', pos: [1, 0, 0], facing: 4 });
  s = reducer(s, { type: 'select', key: 'distillery_lv' });
  s = reducer(s, { type: 'place', pos: [2, 0, 0] });
  expect(toBuild(s).blocks).toEqual([
    { pos: [0, 0, 0], key: 'distillery_lv', facing: 4 },
    { pos: [1, 0, 0], key: 'tin_cable_1x' },
    { pos: [2, 0, 0], key: 'distillery_lv', facing: 3 },
  ]);
});

test('placing on an occupied cell or with an unknown selection returns the same state', () => {
  const s1 = reducer(initialState(), { type: 'place', pos: [0, 0, 0] });
  expect(reducer(s1, { type: 'place', pos: [0, 0, 0] })).toBe(s1);
  const bad = reducer(s1, { type: 'select', key: 'nope' });
  expect(bad).toBe(s1);
});

test('remove, rotate and toggleSide delegate to editing ops', () => {
  let s = reducer(initialState(), { type: 'place', pos: [0, 0, 0] });
  s = reducer(s, { type: 'rotate', pos: [0, 0, 0], includeVertical: false });
  expect(toBuild(s).blocks[0].facing).toBe(4);
  s = reducer(s, { type: 'remove', pos: [0, 0, 0] });
  expect(toBuild(s).blocks).toEqual([]);
  s = reducer(s, { type: 'select', key: 'tin_cable_1x' });
  s = reducer(s, { type: 'place', pos: [0, 0, 0] });
  s = reducer(s, { type: 'toggleSide', pos: [0, 0, 0], side: 1 });
  expect(toBuild(s).blocks[0].manualMask).toEqual({ forcedOn: 2, forcedOff: 0 });
});

test('load replaces blocks and name and resets the layer; new clears everything', () => {
  let s = reducer(initialState(), { type: 'setLayer', layer: 2 });
  s = reducer(s, { type: 'load', build: { version: 1, name: 'b', blocks: [{ pos: [0, 5, 0], key: 'tin_cable_1x' }] } });
  expect(s.name).toBe('b');
  expect(s.layer).toBeNull();
  expect(s.blocks.size).toBe(1);
  s = reducer(s, { type: 'new' });
  expect(s.blocks.size).toBe(0);
  expect(s.name).toBe('untitled');
});

test('setName keeps exactly what was typed (so the field can be cleared and spaced); toBuild tidies it', () => {
  const typed = reducer(initialState(), { type: 'setName', name: 'my line ' });
  expect(typed.name).toBe('my line ');
  expect(toBuild(typed).name).toBe('my line');
  const cleared = reducer(initialState(), { type: 'setName', name: '' });
  expect(cleared.name).toBe('');
  expect(toBuild(cleared).name).toBe('untitled');
});
