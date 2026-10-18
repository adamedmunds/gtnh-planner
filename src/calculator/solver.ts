import wasmUrl from 'highs/runtime?url';
import { createHighsSolver } from '../calc/solver/highs';
import type { LpSolver } from '../calc/solver/types';

let solver: Promise<LpSolver> | undefined;

/** The browser's HiGHS solver, loaded once; a failed load is retried next time. */
export function getSolver(): Promise<LpSolver> {
  solver ??= createHighsSolver({ locateFile: () => wasmUrl }).catch((e) => {
    solver = undefined;
    throw e;
  });
  return solver;
}
