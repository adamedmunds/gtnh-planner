import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from '../calc/chain';
import { solveChain, type ChainResult } from '../calc/solve';
import type { RecipeDb } from '../recipes/db';
import { getSolver } from './solver';
import { createLatest, displayResult } from './solveState';

const failed = (message: string): ChainResult => ({
  status: 'error', message, shortfalls: [], bindingLimits: [], bindingMachines: [], nodes: [],
  inputs: new Map(), outputs: new Map(), byproducts: new Map(), euUsed: 0, euMade: 0,
});

/** Re-solves on every chain change; an older solve never overwrites a newer one. */
export function useSolve(chain: Chain, db: RecipeDb | undefined): { result?: ChainResult; greyed: boolean; problem?: string; solving: boolean } {
  const latest = useMemo(createLatest, []);
  const [current, setCurrent] = useState<ChainResult>();
  const lastOk = useRef<ChainResult>(undefined);
  const [solving, setSolving] = useState(false);

  useEffect(() => {
    if (!db) return;
    const ticket = latest.next();
    setSolving(true);
    getSolver()
      .then((solver) => solveChain(chain, db, solver))
      .catch((e: Error) => failed(e.message))
      .then((r) => {
        if (!latest.isLatest(ticket)) return;
        if (r.status === 'ok') lastOk.current = r;
        setCurrent(r);
        setSolving(false);
      });
  }, [chain, db, latest]);

  return { ...displayResult(current, lastOk.current), solving };
}
