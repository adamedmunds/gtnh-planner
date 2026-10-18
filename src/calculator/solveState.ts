import type { ChainResult } from '../calc/solve';

/**
 * What to show: an ok result as is; an infeasible one greyed (its best-effort numbers show what is reachable);
 * for unbounded or failed solves, the last ok numbers greyed.
 */
export function displayResult(current: ChainResult | undefined, lastOk: ChainResult | undefined): { result?: ChainResult; greyed: boolean } {
  if (!current) return { result: lastOk, greyed: false };
  if (current.status === 'ok') return { result: current, greyed: false };
  if (current.status === 'infeasible') return { result: current, greyed: true };
  return { result: lastOk, greyed: true };
}

/** Tickets for async work: only the newest one may publish its result. */
export function createLatest() {
  let last = 0;
  return {
    next: () => ++last,
    isLatest: (ticket: number) => ticket === last,
  };
}
