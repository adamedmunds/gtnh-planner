import loadHighs from 'highs';
import type { LpModel, LpResult, LpSolver } from './types';

const num = (n: number) => (Number.isFinite(n) ? String(n) : '0');

function term(coef: number, v: string, first: boolean): string {
  const sign = coef < 0 ? '-' : first ? '' : '+';
  return `${sign} ${num(Math.abs(coef))} ${v}`.trim();
}

/** Writes CPLEX LP text using generated names, so arbitrary variable/row names never reach the parser. */
function toLp(model: LpModel): { text: string; vars: string[] } {
  const vars: string[] = [];
  const id = new Map<string, string>();
  const v = (name: string) => {
    let s = id.get(name);
    if (!s) {
      s = `v${vars.length}`;
      vars.push(name);
      id.set(name, s);
    }
    return s;
  };
  const expr = (terms: Record<string, number>) => {
    const parts = Object.entries(terms)
      .filter(([, c]) => c !== 0)
      .map(([name, c], i) => term(c, v(name), i === 0));
    return parts.length ? parts.join(' ') : '';
  };
  const rows = model.constraints.map((c, i) => {
    const lhs = expr(c.terms);
    return lhs ? ` c${i}: ${lhs} ${c.op} ${num(c.rhs)}` : '';
  });
  let objective = expr(model.objective);
  // Every variable must appear somewhere; give unused ones a zero objective term.
  if (!objective) objective = vars.length ? `0 ${v(vars[0])}` : '0 v_dummy';
  const text = [
    model.sense === 'max' ? 'Maximize' : 'Minimize',
    ` obj: ${objective}`,
    'Subject To',
    ...rows.filter(Boolean),
    'End',
  ].join('\n');
  return { text, vars };
}

/** LP solver backed by HiGHS (WebAssembly). `settings` is passed to the HiGHS loader (e.g. `locateFile` in browsers). */
export async function createHighsSolver(settings?: Parameters<typeof loadHighs>[0]): Promise<LpSolver> {
  const highs = await loadHighs(settings);
  return {
    async solve(model) {
      // A constraint with no terms is just a comparison of constants; if it fails, nothing can satisfy the model.
      for (const c of model.constraints) {
        if (Object.values(c.terms).some((v) => v !== 0)) continue;
        const holds = c.op === '>=' ? 0 >= c.rhs : c.op === '<=' ? 0 <= c.rhs : c.rhs === 0;
        if (!holds) return { status: 'infeasible' };
      }
      const { text, vars } = toLp(model);
      let result: ReturnType<typeof highs.solve>;
      try {
        result = highs.solve(text, { output_flag: false });
      } catch (e) {
        return { status: 'error', message: (e as Error).message };
      }
      const status = String(result.Status);
      if (status === 'Optimal') {
        const values: Record<string, number> = {};
        vars.forEach((name, i) => {
          values[name] = (result.Columns as Record<string, { Primal: number }>)[`v${i}`]?.Primal ?? 0;
        });
        return { status: 'optimal', objective: result.ObjectiveValue, values } satisfies LpResult;
      }
      if (/infeasible/i.test(status) && !/unbounded/i.test(status)) return { status: 'infeasible' };
      if (/unbounded/i.test(status)) return { status: 'unbounded' };
      return { status: 'error', message: status };
    },
  };
}
