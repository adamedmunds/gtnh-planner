import { initialHistory, historyReducer } from './history';
import { toBuild } from './state';

const place = (x: number) => ({ type: 'place', pos: [x, 0, 0] } as const);

test('undo and redo step through block changes', () => {
  let h = initialHistory();
  h = historyReducer(h, place(0));
  h = historyReducer(h, place(1));
  expect(h.present.blocks.size).toBe(2);
  h = historyReducer(h, { type: 'undo' });
  expect(h.present.blocks.size).toBe(1);
  h = historyReducer(h, { type: 'undo' });
  expect(h.present.blocks.size).toBe(0);
  h = historyReducer(h, { type: 'undo' }); // nothing left: no-op
  expect(h.present.blocks.size).toBe(0);
  h = historyReducer(h, { type: 'redo' });
  expect(h.present.blocks.size).toBe(1);
});

test('a new change clears the redo stack; no-op actions add no history', () => {
  let h = historyReducer(initialHistory(), place(0));
  h = historyReducer(h, { type: 'undo' });
  h = historyReducer(h, place(5));
  expect(historyReducer(h, { type: 'redo' })).toBe(h);
  const before = h;
  h = historyReducer(h, place(5)); // occupied: no change
  expect(h).toBe(before);
  h = historyReducer(h, { type: 'select', key: 'tin_cable_1x' }); // non-block change
  expect(h.past).toHaveLength(before.past.length);
});

test('loading a build can be undone', () => {
  let h = historyReducer(initialHistory(), place(0));
  h = historyReducer(h, { type: 'load', build: { version: 1, name: 'x', blocks: [] } });
  expect(h.present.blocks.size).toBe(0);
  h = historyReducer(h, { type: 'undo' });
  expect(h.present.blocks.size).toBe(1);
});

test('history is capped', () => {
  let h = initialHistory();
  for (let i = 0; i < 150; i++) h = historyReducer(h, place(i));
  expect(h.past.length).toBe(100);
});

test('undoing a load brings back the previous notes too', () => {
  let h = initialHistory({ version: 1, name: 'a', blocks: [{ pos: [0, 0, 0], key: 'distillery_lv' }], notes: ['old'] });
  h = historyReducer(h, { type: 'load', build: { version: 1, name: 'b', blocks: [], notes: ['new'] } });
  expect(toBuild(h.present).notes).toEqual(['new']);
  h = historyReducer(h, { type: 'undo' });
  expect(toBuild(h.present).notes).toEqual(['old']);
});
