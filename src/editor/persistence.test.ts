import { STORAGE_KEY, loadFromStorage, saveToStorage } from './persistence';
import type { Build } from '../model/types';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}
const throwing: Storage = {
  length: 0,
  clear() {}, key: () => null, removeItem() {},
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
};
const build: Build = { version: 1, name: 'b', blocks: [{ pos: [0, 0, 0], key: 'distillery_lv', facing: 3 }] };

test('saves and restores a build', () => {
  const s = memoryStorage();
  expect(saveToStorage(s, build)).toBe(true);
  expect(loadFromStorage(s)).toEqual({ build });
});

test('empty storage restores nothing, without an error', () => {
  expect(loadFromStorage(memoryStorage())).toEqual({ build: null });
});

test('corrupt storage restores nothing and reports an error', () => {
  const s = memoryStorage();
  s.setItem(STORAGE_KEY, '{oops');
  const r = loadFromStorage(s);
  expect(r.build).toBeNull();
  expect(r.error).toMatch(/restore/i);
});

test('unavailable or throwing storage never throws', () => {
  expect(saveToStorage(undefined, build)).toBe(false);
  expect(saveToStorage(throwing, build)).toBe(false);
  expect(loadFromStorage(undefined)).toEqual({ build: null });
  expect(loadFromStorage(throwing).build).toBeNull();
});
