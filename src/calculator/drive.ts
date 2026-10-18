import type { Chain, ChainNode, Target } from '../calc/chain';
import { nodeRates } from '../calc/rates';
import { solveChain, type ChainResult } from '../calc/solve';
import type { LpSolver } from '../calc/solver/types';
import type { RecipeDb } from '../recipes/db';
import { EU, type ResourceKey } from '../recipes/types';
import { formatNumber } from './format';
import { machineName, resourceInfo } from './graphModel';

/** A "What I have" box: an input from outside, with how much there is when typed. */
export interface HaveBox { key: ResourceKey; amount?: number }

export type ScreenMode = 'exact' | 'max' | 'oneMachine';

export type Shortfall =
  | { kind: 'have'; key: ResourceKey; need: number; have: number }
  | { kind: 'machines'; id: string; need: number; have: number };

/** What the Calculator shows: a solve of the chain as the user drives it. */
export interface ScreenSolve {
  result: ChainResult;
  mode: ScreenMode;
  product?: { key: ResourceKey; provisional: boolean };
  /** The node shown at one machine in 'oneMachine' mode. */
  oneMachineId?: string;
  shortfalls: Shortfall[];
}

/** One "What I get": chains saved with several targets keep the first. */
export function normalizeChain(chain: Chain): Chain {
  return chain.targets.length > 1 ? { ...chain, targets: chain.targets.slice(0, 1) } : chain;
}

export function haveBoxes(chain: Chain): HaveBox[] {
  const amount = new Map(chain.limits.map((l) => [l.key, l.maxRate]));
  const keys = [...new Set([...chain.externals, ...chain.limits.map((l) => l.key)])];
  return keys.map((key) => (amount.has(key) ? { key, amount: amount.get(key)! } : { key }));
}

const perMachine = (n: ChainNode, db: RecipeDb) => {
  const r = nodeRates(n, db);
  return r.valid ? r.perMachine : undefined;
};

/** The product: what the user wants, else (while building forward) the newest node's output nothing else uses. */
export function productOf(chain: Chain, db: RecipeDb): { key: ResourceKey; provisional: boolean } | undefined {
  if (chain.targets[0]) return { key: chain.targets[0].key, provisional: false };
  const rates = chain.nodes.map((n) => perMachine(n, db));
  for (let i = chain.nodes.length - 1; i >= 0; i--) {
    for (const [key, v] of rates[i] ?? []) {
      if (v <= 0 || key === EU) continue;
      if (!rates.some((r, j) => j !== i && (r?.get(key) ?? 0) < 0)) return { key, provisional: true };
    }
  }
  return undefined;
}

/** The chain with the first node that makes `key` capped at one machine. */
function oneMachineOf(chain: Chain, key: ResourceKey, db: RecipeDb): { chain: Chain; id: string } | undefined {
  const step = chain.nodes.find((n) => (perMachine(n, db)?.get(key) ?? 0) > 0);
  if (!step) return undefined;
  return { chain: { ...chain, nodes: chain.nodes.map((n) => (n.id === step.id ? { ...n, maxMachines: Math.min(n.maxMachines ?? 1, 1) } : n)) }, id: step.id };
}

/**
 * Solves the chain the way the screen reads it: with nothing typed, one machine of the product step; with amounts
 * typed, as much as they allow; with a wanted rate, exactly that — and when that can't be reached, what each typed
 * number would need to be (from a second solve without them).
 */
export async function solveForScreen(chain: Chain, db: RecipeDb, solver: LpSolver): Promise<ScreenSolve> {
  const product = productOf(chain, db);
  if (!product) return { result: await solveChain(chain, db, solver), mode: 'max', shortfalls: [] };
  const target: Target = chain.targets[0] ?? { key: product.key, maximise: true };
  const eff: Chain = { ...chain, targets: [target] };

  if ('maximise' in target) {
    const hasCaps = chain.limits.length > 0 || chain.nodes.some((n) => n.maxMachines !== undefined);
    const result = hasCaps ? await solveChain(eff, db, solver) : undefined;
    if (result && result.status !== 'unbounded') return { result, mode: 'max', product, shortfalls: [] };
    const one = oneMachineOf(eff, product.key, db);
    if (!one) return { result: result ?? (await solveChain(eff, db, solver)), mode: 'max', product, shortfalls: [] };
    return { result: await solveChain(one.chain, db, solver), mode: 'oneMachine', product, oneMachineId: one.id, shortfalls: [] };
  }

  const result = await solveChain(eff, db, solver);
  if (result.status !== 'infeasible') return { result, mode: 'exact', product, shortfalls: [] };
  const free: Chain = { ...eff, limits: [], nodes: eff.nodes.map(({ maxMachines: _, ...n }) => n as ChainNode) };
  const uncapped = await solveChain(free, db, solver);
  const over = (need: number, have: number) => need > have * (1 + 1e-6) + 1e-9;
  const shortfalls: Shortfall[] = [];
  if (uncapped.status === 'ok') {
    for (const l of chain.limits) {
      const need = uncapped.inputs.get(l.key) ?? 0;
      if (over(need, l.maxRate)) shortfalls.push({ kind: 'have', key: l.key, need, have: l.maxRate });
    }
    for (const n of chain.nodes) {
      if (n.maxMachines === undefined) continue;
      const need = uncapped.nodes.find((r) => r.id === n.id)?.machines ?? 0;
      if (over(need, n.maxMachines)) shortfalls.push({ kind: 'machines', id: n.id, need, have: n.maxMachines });
    }
  }
  return { result, mode: 'exact', product, shortfalls };
}

/** "5.57 Oil Berry/s", "1,000 L/s Light Fuel". */
function amount(n: number, key: ResourceKey, db: RecipeDb): string {
  const { name, kind } = resourceInfo(key, db);
  return kind === 'fluid' ? `${formatNumber(n)} L/s ${name}` : `${formatNumber(n)} ${name}/s`;
}

const nodeName = (chain: Chain, id: string, db: RecipeDb) => {
  const n = chain.nodes.find((x) => x.id === id);
  return n ? machineName(n, db) : id;
};

/** Problems in plain words: what falls short and by how much, then machines that can't run. */
export function screenProblems(s: ScreenSolve, chain: Chain, db: RecipeDb): string[] {
  const out: string[] = [];
  for (const f of s.shortfalls) {
    if (f.kind === 'have') {
      const { name, kind } = resourceInfo(f.key, db);
      out.push(kind === 'fluid'
        ? `Needs ${formatNumber(f.need)} L/s ${name} — you have ${formatNumber(f.have)}`
        : `Needs ${formatNumber(f.need)} ${name}/s — you have ${formatNumber(f.have)}`);
    } else {
      out.push(`Needs ${formatNumber(f.need)} ${nodeName(chain, f.id, db)} — you set ${formatNumber(f.have)}`);
    }
  }
  const { status } = s.result;
  if (status === 'infeasible' && !s.shortfalls.length && s.product) {
    out.push(`The machines in the line can't make that much ${resourceInfo(s.product.key, db).name}`);
  } else if (status === 'unbounded') {
    out.push('Type how much you have or how much you want');
  } else if (status === 'error') {
    out.push(`Couldn't work this out: ${s.result.message ?? 'unknown error'}`);
  }
  for (const n of chain.nodes) {
    const r = nodeRates(n, db);
    if (!r.valid) out.push(`${machineName(n, db)}: ${r.reason}`);
  }
  return out;
}

/** One plain line saying how the line is being driven. */
export function driveText(s: ScreenSolve, chain: Chain, db: RecipeDb): string {
  if (!s.product) return 'Pick what you want to make, or what you have';
  const name = resourceInfo(s.product.key, db).name;
  if (s.mode === 'oneMachine') return `Showing one ${nodeName(chain, s.oneMachineId!, db)} — type how much you have or want`;
  const [t] = chain.targets;
  if (s.mode === 'exact' && t && 'rate' in t) return `Making ${amount(t.rate, t.key, db)}`;
  const caps = [
    ...chain.limits.map((l) => amount(l.maxRate, l.key, db)),
    ...chain.nodes.filter((n) => n.maxMachines !== undefined).map((n) => `${formatNumber(n.maxMachines!)} ${machineName(n, db)}`),
  ];
  if (!caps.length) return `Making as much ${name} as possible`;
  return `Making as much ${name} as ${caps.join(' and ')} ${caps.length > 1 ? 'allow' : 'allows'}`;
}
