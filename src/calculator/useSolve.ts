import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from '../calc/chain';
import type { ChainResult } from '../calc/solve';
import type { RecipeDb } from '../recipes/db';
import { solveForScreen, type ScreenSolve } from './drive';
import { getSolver } from './solver';
import { createLatest } from './solveState';

const failed = (message: string): ScreenSolve => ({
  result: {
    status: 'error', message, shortfalls: [], bindingLimits: [], bindingMachines: [], nodes: [],
    inputs: new Map(), outputs: new Map(), byproducts: new Map(), euUsed: 0, euMade: 0,
  } satisfies ChainResult,
  mode: 'max',
  shortfalls: [],
});

/**
 * Re-solves on every chain change; an older solve never overwrites a newer one. `current` is the latest solve (its
 * problems are what to report); `shown` is the one whose numbers to draw: the latest, or for an unbounded/failed
 * solve the last good one, greyed.
 */
export function useSolve(chain: Chain, db: RecipeDb | undefined): { current?: ScreenSolve; shown?: ScreenSolve; greyed: boolean; solving: boolean } {
  const latest = useMemo(createLatest, []);
  const [current, setCurrent] = useState<ScreenSolve>();
  const lastOk = useRef<ScreenSolve>(undefined);
  const [solving, setSolving] = useState(false);

  useEffect(() => {
    if (!db) return;
    const ticket = latest.next();
    setSolving(true);
    getSolver()
      .then((solver) => solveForScreen(chain, db, solver))
      .catch((e: Error) => failed(e.message))
      .then((s) => {
        if (!latest.isLatest(ticket)) return;
        if (s.result.status === 'ok') lastOk.current = s;
        setCurrent(s);
        setSolving(false);
      });
  }, [chain, db, latest]);

  const status = current?.result.status;
  const shown = !current || status === 'ok' || status === 'infeasible' ? current : lastOk.current ?? current;
  return { current, shown, greyed: !!current && status !== 'ok', solving };
}
