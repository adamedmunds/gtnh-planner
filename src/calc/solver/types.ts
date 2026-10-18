/** A linear program over non-negative variables. */
export interface LpModel {
  sense: 'min' | 'max';
  objective: Record<string, number>;
  constraints: { name: string; terms: Record<string, number>; op: '>=' | '<=' | '='; rhs: number }[];
}

export type LpResult =
  | { status: 'optimal'; objective: number; values: Record<string, number> }
  | { status: 'infeasible' }
  | { status: 'unbounded' }
  | { status: 'error'; message: string };

export interface LpSolver {
  solve(model: LpModel): Promise<LpResult>;
}
