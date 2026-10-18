import type { RecipeDb } from '../recipes/db';
import { EU, type ResourceKey } from '../recipes/types';
import type { Chain } from './chain';
import { nodeRates } from './rates';
import type { LpModel, LpSolver } from './solver/types';

export interface NodeResult {
  id: string;
  /** Machines running (fractional). */
  machines: number;
  /** Machines to build (rounded up). */
  build: number;
  /** Total EU/t: negative for consumers, positive for generators. */
  eut: number;
  /** Totals per second (`eu` in EU/t). */
  rates: Map<ResourceKey, number>;
  invalid?: string;
  approximate: boolean;
}

export interface ChainResult {
  status: 'ok' | 'infeasible' | 'unbounded' | 'error';
  message?: string;
  shortfalls: { key: ResourceKey; needed: number; available: number }[];
  nodes: NodeResult[];
  /** Taken from outside the chain, per second. */
  inputs: Map<ResourceKey, number>;
  /** Target resources produced, per second (net). */
  outputs: Map<ResourceKey, number>;
  /** Other surplus produced, per second. */
  byproducts: Map<ResourceKey, number>;
  euUsed: number;
  euMade: number;
}

const EPS = 1e-9;
/** Tie-break weight: among equally good plans prefer fewer machines and fewer outside inputs. */
const TIE = 1e-6;
/** Cost of missing a rate target in the elastic re-solve. */
const SHORTFALL_COST = 1e6;

/** Balances a production chain with linear programming (spec §2). */
export async function solveChain(chain: Chain, db: RecipeDb, solver: LpSolver): Promise<ChainResult> {
  const valid: { id: string; perMachine: Map<ResourceKey, number>; eut: number; approximate: boolean }[] = [];
  const invalidNodes: NodeResult[] = [];
  for (const node of chain.nodes) {
    const r = nodeRates(node, db);
    if (r.valid) valid.push({ id: node.id, perMachine: r.perMachine, eut: r.eut, approximate: r.approximate });
    else invalidNodes.push({ id: node.id, machines: 0, build: 0, eut: 0, rates: new Map(), invalid: r.reason, approximate: false });
  }

  const x = (id: string) => `x_${id}`;
  const net = new Map<ResourceKey, Record<string, number>>(); // resource → { x_node: coefficient }
  const produced = new Set<ResourceKey>();
  for (const n of valid) {
    for (const [key, coef] of n.perMachine) {
      const row = net.get(key) ?? {};
      row[x(n.id)] = (row[x(n.id)] ?? 0) + coef;
      net.set(key, row);
      if (coef > 0) produced.add(key);
    }
  }
  const hasGenerators = chain.nodes.some((n) => n.kind === 'generator') && produced.has(EU);
  const externals = new Set(chain.externals);
  const limitOf = new Map(chain.limits.map((l) => [l.key, l.maxRate]));
  const rateTargets = chain.targets.filter((t): t is { key: string; rate: number } => 'rate' in t);
  const maxTargets = chain.targets.filter((t) => 'maximise' in t).map((t) => t.key);
  const targetKeys = new Set(chain.targets.map((t) => t.key));

  const baseConstraints: LpModel['constraints'] = [];
  for (const [key, terms] of net) {
    const limit = limitOf.get(key);
    if (limit !== undefined) baseConstraints.push({ name: `limit_${key}`, terms, op: '>=', rhs: -limit });
    const rateTarget = rateTargets.find((t) => t.key === key);
    if (rateTarget || maxTargets.includes(key)) continue; // target rows are added per model below
    if (key === EU ? hasGenerators : produced.has(key) && !externals.has(key) && limit === undefined) {
      baseConstraints.push({ name: `bal_${key}`, terms, op: '>=', rhs: 0 });
    }
  }
  for (const t of maxTargets) if (net.has(t)) baseConstraints.push({ name: `tgt_${t}`, terms: net.get(t)!, op: '>=', rhs: 0 });

  // Tie-break objective: fewer machines, and less taken from outside (resources nothing in the chain makes).
  const tie: Record<string, number> = {};
  for (const n of valid) tie[x(n.id)] = TIE;
  for (const [key, terms] of net) {
    if (produced.has(key) && key !== EU) continue;
    for (const [v, c] of Object.entries(terms)) if (c < 0) tie[v] = (tie[v] ?? 0) - c * TIE * TIE;
  }

  const model = (elastic: boolean): LpModel => {
    const constraints = [...baseConstraints];
    const objective: Record<string, number> = {};
    rateTargets.forEach((t, i) => {
      const terms = { ...(net.get(t.key) ?? {}) };
      if (elastic) terms[`s_${i}`] = 1;
      constraints.push({ name: `tgt_${t.key}`, terms, op: '>=', rhs: t.rate });
      if (elastic) objective[`s_${i}`] = SHORTFALL_COST;
    });
    if (maxTargets.length && !elastic) {
      for (const t of maxTargets) for (const [v, c] of Object.entries(net.get(t) ?? {})) objective[v] = (objective[v] ?? 0) + c;
      for (const [v, c] of Object.entries(tie)) objective[v] = (objective[v] ?? 0) - c;
      return { sense: 'max', objective, constraints };
    }
    for (const [v, c] of Object.entries(tie)) objective[v] = (objective[v] ?? 0) + c;
    return { sense: 'min', objective, constraints };
  };

  const empty = (status: ChainResult['status'], message?: string): ChainResult => ({
    status, message, shortfalls: [], nodes: [...invalidNodes], inputs: new Map(), outputs: new Map(), byproducts: new Map(), euUsed: 0, euMade: 0,
  });

  const first = await solver.solve(model(false));
  if (first.status === 'error') return empty('error', first.message);
  if (first.status === 'unbounded') {
    const feeding = [...net.keys()]
      .filter((k) => k !== EU && !produced.has(k) && !limitOf.has(k))
      .map((k) => db.resource(k)?.name ?? k);
    const target = maxTargets.map((k) => db.resource(k)?.name ?? k).join(', ');
    return empty('unbounded', `Set a supply limit for ${feeding.join(', ') || 'an input'} to maximise ${target}.`);
  }

  let values: Record<string, number>;
  let status: ChainResult['status'] = 'ok';
  const shortfalls: ChainResult['shortfalls'] = [];
  if (first.status === 'optimal') {
    values = first.values;
  } else {
    const relaxed = await solver.solve(model(true));
    if (relaxed.status !== 'optimal') return empty('infeasible', 'No balance is possible with these limits and recipes.');
    values = relaxed.values;
    status = 'infeasible';
    rateTargets.forEach((t, i) => {
      const s = relaxed.values[`s_${i}`] ?? 0;
      if (s > EPS) shortfalls.push({ key: t.key, needed: t.rate, available: t.rate - s });
    });
  }

  const nodes: NodeResult[] = valid.map((n) => {
    const m = Math.max(0, values[x(n.id)] ?? 0);
    const rates = new Map<ResourceKey, number>();
    for (const [k, c] of n.perMachine) rates.set(k, c * m);
    return { id: n.id, machines: m, build: Math.ceil(m - 1e-6), eut: (n.perMachine.get(EU) ?? 0) * m, rates, approximate: n.approximate };
  });
  const totals = new Map<ResourceKey, number>();
  let euUsed = 0;
  let euMade = 0;
  for (const n of nodes) {
    for (const [k, v] of n.rates) totals.set(k, (totals.get(k) ?? 0) + v);
    const e = n.rates.get(EU) ?? 0;
    if (e < 0) euUsed -= e;
    else euMade += e;
  }
  const inputs = new Map<ResourceKey, number>();
  const outputs = new Map<ResourceKey, number>();
  const byproducts = new Map<ResourceKey, number>();
  for (const [k, v] of totals) {
    if (k === EU) continue;
    if (v < -1e-7) inputs.set(k, -v);
    else if (v > 1e-7) (targetKeys.has(k) ? outputs : byproducts).set(k, v);
  }
  return { status, shortfalls, nodes: [...nodes, ...invalidNodes], inputs, outputs, byproducts, euUsed, euMade };
}
