import { parseBuild, serializeBuild } from '../model/buildJson';
import type { Build } from '../model/types';

export const STORAGE_KEY = 'gtnh-planner:build';
/** Where an unreadable saved build is copied before autosave can overwrite it. */
export const BACKUP_KEY = 'gtnh-planner:build:backup';

export function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function saveToStorage(storage: Storage | undefined, build: Build): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeBuild(build));
    return true;
  } catch {
    return false;
  }
}

const UNAVAILABLE = "Browser storage isn't available, so your build won't autosave. Use Save .json to keep it.";

export function loadFromStorage(storage: Storage | undefined): { build: Build | null; error?: string; unavailable?: boolean } {
  if (!storage) return { build: null, error: UNAVAILABLE, unavailable: true };
  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { build: null, error: UNAVAILABLE, unavailable: true };
  }
  if (text === null) return { build: null };
  try {
    return { build: parseBuild(text).build };
  } catch {
    try {
      storage.setItem(BACKUP_KEY, text);
    } catch {
      return { build: null, error: "Couldn't restore your last build; starting empty." };
    }
    return { build: null, error: `Couldn't restore your last build (backed up in browser storage as "${BACKUP_KEY}"); starting empty.` };
  }
}

/**
 * Returns a save function that writes the build and calls `notify` once when saving starts failing (again
 * after any success), so the user hears about it without a toast on every autosave.
 */
export function createAutosaver(
  getStorage: () => Storage | undefined,
  notify: (message: string) => void,
  { alreadyNotified = false } = {},
): (build: Build) => void {
  let told = alreadyNotified;
  return (build) => {
    if (saveToStorage(getStorage(), build)) {
      told = false;
    } else if (!told) {
      told = true;
      notify("Couldn't autosave your build (storage full or blocked). Use Save .json to keep it.");
    }
  };
}
