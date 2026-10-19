import type { RecipeDb } from '../recipes/db';
import { EU, type ResourceKey } from '../recipes/types';
import type { Chain, Limit } from './chain';
import { generatorOptions } from './machines';
import { nodeRates, nodeTier } from './rates';
import { TIER_NAMES, tierForEut } from './tiers';
import type { LpModel, LpSolver } from './solver/types';

/** One voltage's generators of a generator node that matches each machine's voltage. */
export interface TierGenerators { tier: string; machineMID: number; machines: number; build: number; eut: number }

export interface NodeResult {
  id: string;
  /** Generators matching each voltage: each voltage's generators (totals are on the node). */
  tiers?: TierGenerators[];
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
  /** Supply limits the solution is pressed up against: the reason more cannot be made. */
  bindingLimits: Limit[];
  /** Machine caps the solution is pressed up against. */
  bindingMachines: { id: string; maxMachines: number }[];
  nodes: NodeResult[];
  /** Taken from outside the chain, per second. */
  inputs: Map<ResourceKey, number>;
  /** Target resources produced, per second (net). */
  outputs: Map<ResourceKey, number>;
  /** Other surplus produced, per second. */
  byproducts: Map<ResourceKey, number>;
  euUsed: number;
  euMade: number;
  /** EU/t the line can't make at each voltage (nothing gives that voltage), so it comes from outside. */
  euOutside: Partial<Record<string, number>>;
}

const EPS = 1e-9;
const round = (n: number) => Math.round(n * 100) / 100;
/** Tie-break weight: among equally good plans prefer fewer machines and fewer outside inputs. */
const TIE = 1e-6;
/** Cost of missing a rate target in the elastic re-solve. */
const SHORTFALL_COST = 1e6;
const euAt = (tier: string) => `eu@${tier}`;
const isEu = (k: ResourceKey) => k === EU || k.startsWith('eu@');

/** Balances a production chain with linear programming (spec §2). */
export async function solveChain(chain: Chain, db: RecipeDb, solver: LpSolver): Promise<ChainResult> {
  type Valid = { id: string; perMachine: Map<ResourceKey, number>; eut: number; approximate: boolean; maxMachines?: number; tier?: string; parent?: string; machineMID?: number };
  const valid: Valid[] = [];
  const invalidNodes: NodeResult[] = [];
  for (const node of chain.nodes) {
    const r = nodeRates(node, db);
    if (r.valid) valid.push({ id: node.id, perMachine: r.perMachine, eut: r.eut, approximate: r.approximate, maxMachines: node.maxMachines, tier: nodeTier(node, db) });
    else invalidNodes.push({ id: node.id, machines: 0, build: 0, eut: 0, rates: new Map(), invalid: r.reason, approximate: false });
  }

  // Power per voltage once the line has generators: machines draw at their voltage, generators give at theirs, a higher
  // voltage steps down (transformers), never up. A generator matching each voltage becomes one generator per voltage.
  const hasGens = valid.some((v) => chain.nodes.find((n) => n.id === v.id)?.kind === 'generator');
  if (hasGens) {
    const tierOfUse = (v: Valid) => v.tier ?? TIER_NAMES[Math.max(1, tierForEut(Math.abs(v.eut)))];
    const needed = [...new Set(valid.filter((v) => (v.perMachine.get(EU) ?? 0) < 0).map(tierOfUse))];
    for (const node of chain.nodes) {
      if (node.kind !== 'generator' || !node.matchTiers) continue;
      const at = valid.findIndex((v) => v.id === node.id);
      if (at < 0) continue;
      const mapIndex = db.mapIndexById(node.fuelMap)!;
      const options = generatorOptions(mapIndex, db).filter((m) => m.tier !== undefined);
      const chosen = new Map<number, string>(); // machine -> its voltage
      for (const t of needed) {
        const ti = TIER_NAMES.indexOf(t);
        const m = options.find((o) => Math.max(1, o.tier!) === ti) ?? options.find((o) => o.tier! > ti) ?? options[options.length - 1];
        if (m) chosen.set(m.mID, TIER_NAMES[Math.max(1, m.tier!)]);
      }
      const parts: Valid[] = [];
      for (const [mID, tier] of chosen) {
        const r = nodeRates({ ...node, machineMID: mID }, db);
        if (r.valid) parts.push({ id: `${node.id}@${tier}`, perMachine: r.perMachine, eut: r.eut, approximate: r.approximate, tier, parent: node.id, machineMID: mID });
      }
      if (parts.length) valid.splice(at, 1, ...parts);
    }
    for (const v of valid) {
      const e = v.perMachine.get(EU);
      if (e === undefined) continue;
      v.perMachine = new Map(v.perMachine);
      v.perMachine.delete(EU);
      v.perMachine.set(euAt(tierOfUse(v)), e);
    }
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
  const hasGenerators = hasGens && [...produced].some(isEu);
  // Voltages in play: step-down links between neighbours, and outside power at each voltage machines draw at.
  const euTiers = [...net.keys()].filter((k) => k.startsWith('eu@')).map((k) => k.slice(3));
  const lo = Math.min(...euTiers.map((t) => TIER_NAMES.indexOf(t)));
  const hi = Math.max(...euTiers.map((t) => TIER_NAMES.indexOf(t)));
  const extraVars: Record<string, number> = {};
  if (hasGenerators) {
    for (let t = lo; t <= hi; t++) if (!net.has(euAt(TIER_NAMES[t]))) net.set(euAt(TIER_NAMES[t]), {});
    // Outside power only at voltages above every generator's (nothing in the line can give them; no step up), and it
    // stays at its own voltage: stepping down is only from voltages the generators reach.
    const genTop = Math.max(...valid.filter((v) => [...v.perMachine].some(([k, c]) => k.startsWith('eu@') && c > 0)).map((v) => TIER_NAMES.indexOf(v.tier!)));
    for (let t = lo + 1; t <= Math.min(hi, genTop); t++) {
      const down = `d_${TIER_NAMES[t]}`;
      net.get(euAt(TIER_NAMES[t]))![down] = -1;
      net.get(euAt(TIER_NAMES[t - 1]))![down] = 1;
      extraVars[down] = TIE;
    }
    for (const t of euTiers) {
      if (TIER_NAMES.indexOf(t) <= genTop) continue;
      const out = `o_${t}`;
      net.get(euAt(t))![out] = 1;
      extraVars[out] = TIE;
    }
  }
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
    if (isEu(key) ? hasGenerators : produced.has(key) && !externals.has(key) && limit === undefined) {
      baseConstraints.push({ name: `bal_${key}`, terms, op: '>=', rhs: 0 });
    }
  }
  for (const n of valid) {
    if (n.maxMachines !== undefined) baseConstraints.push({ name: `cap_${n.id}`, terms: { [x(n.id)]: 1 }, op: '<=', rhs: n.maxMachines });
  }
  for (const t of maxTargets) if (net.has(t)) baseConstraints.push({ name: `tgt_${t}`, terms: net.get(t)!, op: '>=', rhs: 0 });

  // Tie-break objective: fewer machines, and less taken from outside (resources nothing in the chain makes).
  const tie: Record<string, number> = {};
  for (const n of valid) tie[x(n.id)] = TIE;
  for (const [key, terms] of net) {
    if ((produced.has(key) && !isEu(key)) || key.startsWith('eu@')) continue;
    for (const [v, c] of Object.entries(terms)) if (c < 0 && v.startsWith('x_')) tie[v] = (tie[v] ?? 0) - c * TIE * TIE;
  }
  for (const [v, c] of Object.entries(extraVars)) tie[v] = (tie[v] ?? 0) + c;

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
    status, message, shortfalls: [], bindingLimits: [], bindingMachines: [], nodes: [...invalidNodes], inputs: new Map(), outputs: new Map(), byproducts: new Map(), euUsed: 0, euMade: 0, euOutside: {},
  });

  const name = (k: ResourceKey) => db.resource(k)?.name ?? k;
  const unmade = maxTargets.filter((k) => !produced.has(k));
  if (unmade.length) return empty('infeasible', `Nothing in the chain makes ${unmade.map(name).join(', ')}.`);

  const first = await solver.solve(model(false));
  if (first.status === 'error') return empty('error', first.message);
  if (first.status === 'unbounded') {
    const feeding = [...net.keys()]
      .filter((k) => !isEu(k) && !produced.has(k) && !limitOf.has(k))
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

  const euOf = (pm: Map<ResourceKey, number>) => [...pm].filter(([k]) => isEu(k)).reduce((s, [, c]) => s + c, 0);
  const each: (NodeResult & { parent?: string; tier?: string; machineMID?: number })[] = valid.map((n) => {
    const m = Math.max(0, values[x(n.id)] ?? 0);
    const rates = new Map<ResourceKey, number>();
    for (const [k, c] of n.perMachine) {
      const key = isEu(k) ? EU : k;
      rates.set(key, (rates.get(key) ?? 0) + c * m);
    }
    return { id: n.id, machines: m, build: Math.ceil(m - 1e-6), eut: euOf(n.perMachine) * m, rates, approximate: n.approximate, parent: n.parent, tier: n.tier, machineMID: n.machineMID };
  });
  // A generator matching each voltage: one result with each voltage's generators.
  const nodes: NodeResult[] = [];
  for (const n of each) {
    if (!n.parent) {
      const { parent: _p, tier: _t, machineMID: _m, ...plain } = n;
      nodes.push(plain);
      continue;
    }
    let g = nodes.find((r) => r.id === n.parent);
    if (!g) {
      g = { id: n.parent, machines: 0, build: 0, eut: 0, rates: new Map(), approximate: false, tiers: [] };
      nodes.push(g);
    }
    g.machines += n.machines;
    g.build += n.build;
    g.eut += n.eut;
    g.approximate ||= n.approximate;
    for (const [k, v] of n.rates) g.rates.set(k, (g.rates.get(k) ?? 0) + v);
    g.tiers!.push({ tier: n.tier!, machineMID: n.machineMID!, machines: n.machines, build: n.build, eut: n.eut });
  }
  const euOutside: Partial<Record<string, number>> = {};
  for (const t of euTiers) {
    const o = values[`o_${t}`] ?? 0;
    if (o > 1e-6) euOutside[t] = o;
  }
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
    if (isEu(k)) continue;
    if (v < -1e-7) inputs.set(k, -v);
    else if (v > 1e-7) (targetKeys.has(k) ? outputs : byproducts).set(k, v);
  }
  const bindingLimits = chain.limits.filter((l) => {
    const t = totals.get(l.key);
    return t !== undefined && t <= -l.maxRate + 1e-6 * Math.max(1, l.maxRate);
  });
  const near = (v: number, cap: number) => v >= cap - 1e-6 * Math.max(1, cap);
  const bindingMachines = valid
    .filter((n) => n.maxMachines !== undefined && near(Math.max(0, values[x(n.id)] ?? 0), n.maxMachines))
    .map((n) => ({ id: n.id, maxMachines: n.maxMachines! }));
  let message: string | undefined;
  if (status === 'infeasible') {
    const short = shortfalls.map((f) => `${name(f.key)} (needs ${round(f.needed)}/s, can make ${round(f.available)}/s)`).join(', ');
    const why = bindingLimits.length
      ? `limited by ${bindingLimits.map((l) => `${name(l.key)} ≤ ${round(l.maxRate)}/s`).join(', ')}`
      : 'nothing in the chain can make more';
    message = `Can't reach ${short || 'the targets'}: ${why}.`;
  }
  return { status, message, shortfalls, bindingLimits, bindingMachines, nodes: [...nodes, ...invalidNodes], inputs, outputs, byproducts, euUsed, euMade, euOutside };
}
