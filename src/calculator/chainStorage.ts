import { emptyChain, type Chain } from '../calc/chain';
import { parseChain } from '../project/project';

export const CHAIN_KEY = 'gtnh-planner:chain';

export function loadChain(storage: Storage | undefined): { chain: Chain; error?: string } {
  let text: string | null = null;
  try {
    text = storage?.getItem(CHAIN_KEY) ?? null;
  } catch {
    return { chain: emptyChain() };
  }
  if (text === null) return { chain: emptyChain() };
  try {
    return { chain: parseChain(JSON.parse(text), []) };
  } catch {
    return { chain: emptyChain(), error: "Couldn't restore your calculator chain; starting empty." };
  }
}

export function saveChain(storage: Storage | undefined, chain: Chain): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CHAIN_KEY, JSON.stringify(chain));
    return true;
  } catch {
    return false;
  }
}
