import { createContext, useContext } from 'react';
import type { Chain } from '../../calc/chain';
import type { RecipeDb } from '../../recipes/db';
import type { ChainAction } from '../chainState';

/** What node cards need besides their own view: the chain, the recipes and a way to change the chain. */
export interface GraphContextValue {
  chain: Chain;
  db: RecipeDb;
  dispatch: (a: ChainAction) => void;
  greyed: boolean;
}

export const GraphContext = createContext<GraphContextValue | null>(null);

export function useGraph(): GraphContextValue {
  const g = useContext(GraphContext);
  if (!g) throw new Error('useGraph outside GraphContext');
  return g;
}
