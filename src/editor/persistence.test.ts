import { BACKUP_KEY, STORAGE_KEY, createAutosaver, loadFromStorage, saveToStorage } from './persistence';
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

test('an unreadable saved build is backed up before it can be overwritten', () => {
  const s = memoryStorage();
  s.setItem(STORAGE_KEY, '{"version":9}');
  const r = loadFromStorage(s);
  expect(r.build).toBeNull();
  expect(s.getItem(BACKUP_KEY)).toBe('{"version":9}');
  expect(r.error).toMatch(/backed up/i);
});

test('unavailable or throwing storage never throws, and says autosave is off', () => {
  expect(saveToStorage(undefined, build)).toBe(false);
  expect(saveToStorage(throwing, build)).toBe(false);
  expect(loadFromStorage(undefined)).toMatchObject({ build: null, unavailable: true });
  expect(loadFromStorage(undefined).error).toMatch(/save \.json/i);
  expect(loadFromStorage(throwing)).toMatchObject({ build: null, unavailable: true });
});

test('autosaver notifies once per failure streak, and not at all if already told storage is unavailable', () => {
  const notify = vi.fn();
  const save = createAutosaver(() => throwing, notify);
  save(build);
  save(build);
  expect(notify).toHaveBeenCalledTimes(1);
  const quiet = vi.fn();
  createAutosaver(() => throwing, quiet, { alreadyNotified: true })(build);
  expect(quiet).not.toHaveBeenCalled();
  const recover = vi.fn();
  let storage: Storage = throwing;
  const s2 = createAutosaver(() => storage, recover);
  s2(build);
  storage = memoryStorage();
  s2(build);
  storage = throwing;
  s2(build);
  expect(recover).toHaveBeenCalledTimes(2);
});
