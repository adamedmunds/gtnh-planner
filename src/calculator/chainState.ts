import { emptyChain, type Chain, type ChainNode, type Position, type Target } from '../calc/chain';
import type { ResourceKey } from '../recipes/types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A node before the reducer gives it an id. */
export type NewNode = DistributiveOmit<ChainNode, 'id'>;

export type ChainAction =
  | { type: 'addNode'; node: NewNode }
  | { type: 'removeNode'; id: string }
  | { type: 'moveNode'; id: string; position: Position }
  | { type: 'arrange'; positions: Record<string, Position> }
  | { type: 'setMachine'; id: string; machineMID: number }
  | { type: 'setOverclock'; id: string; on: boolean }
  | { type: 'setTarget'; target: Target }
  | { type: 'removeTarget'; key: ResourceKey }
  | { type: 'setLimit'; key: ResourceKey; maxRate: number }
  | { type: 'removeLimit'; key: ResourceKey }
  | { type: 'setExternal'; key: ResourceKey; on: boolean }
  | { type: 'load'; chain: Chain };

/** `n<k>` past the highest `n<digits>` id in the chain, so ids from loaded files never collide. */
export function nextNodeId(chain: Chain): string {
  let max = 0;
  for (const n of chain.nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

/** Applies `change` to node `id`; the same chain when the node is missing or nothing changed. */
function updateNode(chain: Chain, id: string, change: (n: ChainNode) => ChainNode): Chain {
  let changed = false;
  const nodes = chain.nodes.map((n) => {
    if (n.id !== id) return n;
    const next = change(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...chain, nodes } : chain;
}

export function chainReducer(chain: Chain, a: ChainAction): Chain {
  switch (a.type) {
    case 'addNode':
      return { ...chain, nodes: [...chain.nodes, { ...a.node, id: nextNodeId(chain) } as ChainNode] };
    case 'removeNode':
      return chain.nodes.some((n) => n.id === a.id) ? { ...chain, nodes: chain.nodes.filter((n) => n.id !== a.id) } : chain;
    case 'moveNode':
      return updateNode(chain, a.id, (n) => (n.position.x === a.position.x && n.position.y === a.position.y ? n : { ...n, position: a.position }));
    case 'arrange': {
      if (!chain.nodes.some((n) => a.positions[n.id])) return chain;
      return { ...chain, nodes: chain.nodes.map((n) => (a.positions[n.id] ? { ...n, position: a.positions[n.id] } : n)) };
    }
    case 'setMachine':
      return updateNode(chain, a.id, (n) => (n.machineMID === a.machineMID ? n : { ...n, machineMID: a.machineMID }));
    case 'setOverclock':
      return updateNode(chain, a.id, (n) => (n.kind !== 'recipe' || n.overclock === a.on ? n : { ...n, overclock: a.on }));
    case 'setTarget':
      return { ...chain, targets: [...chain.targets.filter((t) => t.key !== a.target.key), a.target] };
    case 'removeTarget':
      return chain.targets.some((t) => t.key === a.key) ? { ...chain, targets: chain.targets.filter((t) => t.key !== a.key) } : chain;
    case 'setLimit': {
      const old = chain.limits.find((l) => l.key === a.key);
      if (old?.maxRate === a.maxRate) return chain;
      return { ...chain, limits: old ? chain.limits.map((l) => (l.key === a.key ? { key: a.key, maxRate: a.maxRate } : l)) : [...chain.limits, { key: a.key, maxRate: a.maxRate }] };
    }
    case 'removeLimit':
      return chain.limits.some((l) => l.key === a.key) ? { ...chain, limits: chain.limits.filter((l) => l.key !== a.key) } : chain;
    case 'setExternal': {
      const has = chain.externals.includes(a.key);
      if (has === a.on) return chain;
      return { ...chain, externals: a.on ? [...chain.externals, a.key] : chain.externals.filter((k) => k !== a.key) };
    }
    case 'load':
      return a.chain;
  }
}

export interface ChainHistory { past: Chain[]; present: Chain; future: Chain[] }
export type ChainHistoryAction = ChainAction | { type: 'undo' } | { type: 'redo' };

const LIMIT = 100;

export const initialChainHistory = (chain: Chain = emptyChain()): ChainHistory => ({ past: [], present: chain, future: [] });

export function chainHistoryReducer(h: ChainHistory, a: ChainHistoryAction): ChainHistory {
  if (a.type === 'undo') {
    const prev = h.past.at(-1);
    return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
  }
  if (a.type === 'redo') {
    const next = h.future[0];
    return next ? { past: [...h.past, h.present].slice(-LIMIT), present: next, future: h.future.slice(1) } : h;
  }
  const next = chainReducer(h.present, a);
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}
