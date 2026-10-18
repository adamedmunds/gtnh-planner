import type { Chain, Position } from '../calc/chain';
import { nodeRates } from '../calc/rates';
import type { RecipeDb } from '../recipes/db';
import type { ResourceKey } from '../recipes/types';
import { chainEdges } from './graphModel';

export const COLUMN = 360;
export const ROW = 220;

/**
 * Columns by longest path from the chain's sources along producer → consumer links (loops broken where a depth-first
 * walk meets a node already on its path); rows in node order within each column.
 */
export function autoArrange(chain: Chain, db: RecipeDb): Record<string, Position> {
  const ids = chain.nodes.map((n) => n.id);
  const out = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of chainEdges(chain, db)) out.get(e.source)?.add(e.target);
  const hasIn = new Set([...out.values()].flatMap((s) => [...s]));

  // Depth-first from sources first, dropping back edges, leaves a DAG.
  const dag = new Map<string, string[]>(ids.map((id) => [id, []]));
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const t of out.get(id)!) {
      if (state.get(t) === 'open') continue; // back edge
      dag.get(t)!.push(id);
      if (!state.has(t)) visit(t);
    }
    state.set(id, 'done');
  };
  for (const id of [...ids.filter((i) => !hasIn.has(i)), ...ids]) if (!state.has(id)) visit(id);

  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    let d = depth.get(id);
    if (d === undefined) {
      d = Math.max(0, ...dag.get(id)!.map((p) => depthOf(p) + 1));
      depth.set(id, d);
    }
    return d;
  };
  const rows = new Map<number, number>();
  const positions: Record<string, Position> = {};
  for (const id of ids) {
    const col = depthOf(id);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    positions[id] = { x: col * COLUMN, y: row * ROW };
  }
  return positions;
}

/** Where a new node goes: left of what it feeds, right of what feeds it, else below everything; never on a node. */
export function placeNewNode(chain: Chain, db: RecipeDb, io: { inputs: ResourceKey[]; outputs: ResourceKey[] }): Position {
  if (!chain.nodes.length) return { x: 0, y: 0 };
  const touches = (sign: 1 | -1, keys: ResourceKey[]) =>
    chain.nodes.filter((n) => {
      const r = nodeRates(n, db);
      return r.valid && keys.some((k) => sign * (r.perMachine.get(k) ?? 0) > 0);
    });
  const consumers = touches(-1, io.outputs);
  const producers = touches(1, io.inputs);
  let p: Position;
  if (consumers.length) {
    const left = consumers.reduce((a, b) => (b.position.x < a.position.x ? b : a));
    p = { x: left.position.x - COLUMN, y: left.position.y };
  } else if (producers.length) {
    const right = producers.reduce((a, b) => (b.position.x > a.position.x ? b : a));
    p = { x: right.position.x + COLUMN, y: right.position.y };
  } else {
    p = { x: 0, y: Math.max(...chain.nodes.map((n) => n.position.y)) + ROW };
  }
  while (chain.nodes.some((n) => Math.hypot(n.position.x - p.x, n.position.y - p.y) < 100)) p = { x: p.x, y: p.y + ROW };
  return p;
}
