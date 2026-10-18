import type { Chain, ChainNode } from '../calc/chain';
import { generatorOptions, machineOptions } from '../calc/machines';
import { nodeRates } from '../calc/rates';
import type { ChainResult, NodeResult } from '../calc/solve';
import type { RecipeDb } from '../recipes/db';
import { EU, type MachineRef, type Resource, type ResourceKey } from '../recipes/types';

export interface ResourceRow {
  key: ResourceKey;
  name: string;
  kind: Resource['kind'];
  /** Per second, ≥ 0: the solved total, or per machine before a solve. */
  rate: number;
  /** An input nothing in the chain makes. */
  unmet: boolean;
  external: boolean;
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
}

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

export function nodeView(node: ChainNode, chain: Chain, db: RecipeDb, result?: NodeResult): NodeView {
  const rates = nodeRates(node, db);
  const produced = producedKeys(chain, db);
  const externals = new Set(chain.externals);
  const solved = rates.valid && result !== undefined && !result.invalid;
  const row = (key: ResourceKey, perMachine: number, input: boolean): ResourceRow => ({
    key,
    ...resourceInfo(key, db),
    rate: Math.abs(solved ? result!.rates.get(key) ?? 0 : perMachine),
    unmet: input && !produced.has(key),
    external: externals.has(key),
  });

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

  return {
    id: node.id,
    kind: node.kind,
    title,
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
