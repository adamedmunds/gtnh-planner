import type { Chain, ChainNode } from '../calc/chain';
import { generatorOptions, machineOptions } from '../calc/machines';
import { tierName } from '../calc/tiers';
import { nodeRates } from '../calc/rates';
import type { ChainResult, NodeResult } from '../calc/solve';
import type { RecipeDb } from '../recipes/db';
import { EU, type MachineRef, type Resource, type ResourceKey } from '../recipes/types';
import { haveBoxes, type ScreenSolve } from './drive';
import type { RateRow } from './overview';

export interface ResourceRow {
  key: ResourceKey;
  name: string;
  kind: Resource['kind'];
  /** Per second, ≥ 0: the solved total, or per machine before a solve. */
  rate: number;
  /** An input nothing in the chain makes. */
  unmet: boolean;
  external: boolean;
  /** Buttons on the row: add what makes it, I have it, use it in something, I want it. */
  actions: ('make' | 'have' | 'use' | 'want')[];
}

export interface NodeView {
  id: string;
  kind: 'recipe' | 'generator';
  title: string;
  machineMID: number;
  machineOptions: { mID: number; name: string }[];
  overclock?: boolean;
  machines: number;
  build: number;
  eut: number;
  inputs: ResourceRow[];
  outputs: ResourceRow[];
  invalid?: string;
  approximate: boolean;
  tier?: string;
  maxMachines?: number;
  /** Icon key of the machine block. */
  machineIcon: ResourceKey;
}

/** A "What I have" box on the graph. */
export interface HaveView { id: string; key: ResourceKey; name: string; kind: Resource['kind']; amount?: number; used: number }
/** The "What I get" box on the graph. */
export interface GetView { id: string; key: ResourceKey; name: string; kind: Resource['kind']; rate: number; typed?: number; provisional: boolean }

export const haveId = (key: ResourceKey) => `have:${key}`;
export const getId = (key: ResourceKey) => `get:${key}`;

export interface EdgeView { id: string; source: string; target: string; key: ResourceKey; flow: number }

/** Name and kind of a resource, falling back to the key. */
export function resourceInfo(key: ResourceKey, db: RecipeDb): { name: string; kind: Resource['kind'] } {
  const r = db.resource(key);
  if (r) return { name: r.name, kind: r.kind };
  return { name: key, kind: key === EU ? 'eu' : key.startsWith('fluid:') ? 'fluid' : 'item' };
}

/** Machines this node may use (current one included even if it can't run the recipe). */
function options(node: ChainNode, db: RecipeDb): MachineRef[] {
  let list: MachineRef[] = [];
  let all: MachineRef[] = [];
  if (node.kind === 'recipe') {
    const recipe = db.bySignature(node.recipeSig);
    if (recipe) {
      list = machineOptions(recipe, db);
      all = db.map(recipe.map).machines;
    }
  } else {
    const mi = db.mapIndexById(node.fuelMap);
    if (mi !== undefined) {
      list = generatorOptions(mi, db);
      all = db.map(mi).machines;
    }
  }
  if (!list.some((m) => m.mID === node.machineMID)) {
    const current = all.find((m) => m.mID === node.machineMID) ?? { mID: node.machineMID, name: `Machine ${node.machineMID}`, multiblock: false };
    list = [current, ...list];
  }
  return list;
}

export function machineName(node: ChainNode, db: RecipeDb): string {
  return options(node, db).find((m) => m.mID === node.machineMID)!.name;
}

/** Keys some valid node in the chain outputs. */
export function producedKeys(chain: Chain, db: RecipeDb): Set<ResourceKey> {
  const out = new Set<ResourceKey>();
  for (const n of chain.nodes) {
    const r = nodeRates(n, db);
    if (r.valid) for (const [k, v] of r.perMachine) if (v > 0) out.add(k);
  }
  return out;
}

export function nodeView(node: ChainNode, chain: Chain, db: RecipeDb, result?: NodeResult, product?: ResourceKey): NodeView {
  const rates = nodeRates(node, db);
  const produced = producedKeys(chain, db);
  const externals = new Set(chain.externals);
  const solved = rates.valid && result !== undefined && !result.invalid;
  const row = (key: ResourceKey, perMachine: number, input: boolean): ResourceRow => {
    const unmet = input && !produced.has(key);
    const external = externals.has(key);
    const actions: ResourceRow['actions'] = input
      ? (unmet && !external ? ['make', 'have'] : [])
      : (key === product ? ['use'] : ['use', 'want']);
    return { key, ...resourceInfo(key, db), rate: Math.abs(solved ? result!.rates.get(key) ?? 0 : perMachine), unmet, external, actions };
  };

  let title: string;
  const inputs: ResourceRow[] = [];
  const outputs: ResourceRow[] = [];
  let baseEut = rates.valid ? rates.eut : 0;
  if (node.kind === 'recipe') {
    const recipe = db.bySignature(node.recipeSig);
    title = recipe ? db.map(recipe.map).name : 'Missing recipe';
    if (recipe) {
      if (!rates.valid) baseEut = recipe.eut;
      const perSec = 20 / Math.max(1, recipe.duration);
      const seen = new Set<ResourceKey>();
      for (const s of recipe.inputs) {
        if (s.consumed === false || seen.has(s.key)) continue;
        seen.add(s.key);
        inputs.push(row(s.key, rates.valid ? rates.perMachine.get(s.key) ?? 0 : s.amount * perSec, true));
      }
      seen.clear();
      for (const s of recipe.outputs) {
        if (seen.has(s.key)) continue;
        seen.add(s.key);
        outputs.push(row(s.key, rates.valid ? rates.perMachine.get(s.key) ?? 0 : s.amount * (s.chance ?? 1) * perSec, false));
      }
    }
  } else {
    title = `${resourceInfo(node.fuelKey, db).name} → EU`;
    inputs.push(row(node.fuelKey, rates.valid ? rates.perMachine.get(node.fuelKey) ?? 0 : 0, true));
  }

  const current = options(node, db).find((m) => m.mID === node.machineMID);
  return {
    id: node.id,
    kind: node.kind,
    title,
    ...(current && tierName(current) ? { tier: tierName(current) } : {}),
    ...(node.maxMachines !== undefined ? { maxMachines: node.maxMachines } : {}),
    machineIcon: `item:gregtech:gt.blockmachines@${node.machineMID}`,
    machineMID: node.machineMID,
    machineOptions: options(node, db).map((m) => ({ mID: m.mID, name: m.name })),
    ...(node.kind === 'recipe' ? { overclock: node.overclock } : {}),
    machines: solved ? result!.machines : 0,
    build: solved ? result!.build : 0,
    eut: solved ? Math.abs(result!.eut) : Math.abs(baseEut),
    inputs,
    outputs,
    ...(rates.valid ? {} : { invalid: rates.reason }),
    approximate: rates.valid && rates.approximate,
  };
}

/**
 * One edge per producer → consumer of each resource (EU excluded). A consumer's intake is split across producers by
 * their share of production, scaled down when the chain makes less than it uses (the rest comes from outside).
 */
export function chainEdges(chain: Chain, db: RecipeDb, result?: ChainResult): EdgeView[] {
  const perMachine = new Map<string, Map<ResourceKey, number>>();
  for (const n of chain.nodes) {
    const r = nodeRates(n, db);
    if (r.valid) perMachine.set(n.id, r.perMachine);
  }
  const totals = new Map(result?.nodes.map((n) => [n.id, n.rates]) ?? []);
  const keys = new Set<ResourceKey>();
  for (const m of perMachine.values()) for (const k of m.keys()) if (k !== EU) keys.add(k);

  const edges: EdgeView[] = [];
  for (const key of keys) {
    const producers = [...perMachine].filter(([, m]) => (m.get(key) ?? 0) > 0).map(([id]) => id);
    const consumers = [...perMachine].filter(([, m]) => (m.get(key) ?? 0) < 0).map(([id]) => id);
    if (!producers.length || !consumers.length) continue;
    const rate = (id: string) => totals.get(id)?.get(key) ?? 0;
    const made = producers.reduce((s, id) => s + rate(id), 0);
    const used = consumers.reduce((s, id) => s - rate(id), 0);
    const covered = used > 0 ? Math.min(1, made / used) : 0;
    for (const p of producers) {
      for (const c of consumers) {
        if (p === c) continue;
        const flow = made > 0 ? -rate(c) * covered * (rate(p) / made) : 0;
        edges.push({ id: `${p}>${c}:${key}`, source: p, target: c, key, flow });
      }
    }
  }
  return edges;
}

/** The What I have boxes, the What I get box and the other things the line makes. */
export function boxViews(chain: Chain, db: RecipeDb, screen?: ScreenSolve): { haves: HaveView[]; get?: GetView; alsoMade: RateRow[] } {
  const result = screen?.result;
  const haves = haveBoxes(chain).map((h): HaveView => ({
    id: haveId(h.key),
    key: h.key,
    ...resourceInfo(h.key, db),
    ...(h.amount !== undefined ? { amount: h.amount } : {}),
    used: result?.inputs.get(h.key) ?? 0,
  }));
  const product = screen?.product;
  const [t] = chain.targets;
  const get: GetView | undefined = product && {
    id: getId(product.key),
    key: product.key,
    ...resourceInfo(product.key, db),
    rate: result?.outputs.get(product.key) ?? result?.byproducts.get(product.key) ?? 0,
    ...(t && t.key === product.key && 'rate' in t ? { typed: t.rate } : {}),
    provisional: product.provisional,
  };
  const alsoMade = [...(result?.byproducts ?? [])]
    .filter(([k]) => k !== product?.key)
    .map(([key, rate]) => ({ key, ...resourceInfo(key, db), rate }))
    .sort((a, b) => b.rate - a.rate);
  return { haves, ...(get ? { get } : {}), alsoMade };
}

/** Machine-to-machine edges plus what flows out of the have boxes and into the get box. */
export function screenEdges(chain: Chain, db: RecipeDb, screen?: ScreenSolve): EdgeView[] {
  const result = screen?.result;
  const edges = chainEdges(chain, db, result);
  const rates = new Map(chain.nodes.map((n) => [n.id, nodeRates(n, db)]));
  const total = (id: string, key: ResourceKey) => result?.nodes.find((r) => r.id === id)?.rates.get(key) ?? 0;
  const touching = (key: ResourceKey, sign: 1 | -1) =>
    chain.nodes.filter((n) => {
      const r = rates.get(n.id)!;
      return r.valid && sign * (r.perMachine.get(key) ?? 0) > 0;
    }).map((n) => n.id);

  for (const h of haveBoxes(chain)) {
    const consumers = touching(h.key, -1);
    const used = consumers.reduce((s, id) => s - total(id, h.key), 0);
    const fromOutside = result?.inputs.get(h.key) ?? 0;
    for (const c of consumers) {
      const flow = used > 0 ? fromOutside * (-total(c, h.key) / used) : 0;
      edges.push({ id: `${haveId(h.key)}>${c}`, source: haveId(h.key), target: c, key: h.key, flow });
    }
  }
  const product = screen?.product;
  if (product) {
    const producers = touching(product.key, 1);
    const made = producers.reduce((s, id) => s + total(id, product.key), 0);
    const out = result?.outputs.get(product.key) ?? result?.byproducts.get(product.key) ?? 0;
    for (const p of producers) {
      const flow = made > 0 ? out * (total(p, product.key) / made) : 0;
      edges.push({ id: `${p}>${getId(product.key)}`, source: p, target: getId(product.key), key: product.key, flow });
    }
  }
  return edges;
}
