import { parseBuild, serializeBuild } from '../model/buildJson';
import type { Build } from '../model/types';

export const STORAGE_KEY = 'gtnh-planner:build';

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

export function loadFromStorage(storage: Storage | undefined): { build: Build | null; error?: string } {
  if (!storage) return { build: null };
  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { build: null };
  }
  if (text === null) return { build: null };
  try {
    return { build: parseBuild(text).build };
  } catch {
    return { build: null, error: "Couldn't restore your last build; starting empty." };
  }
}
