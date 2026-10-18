import type { Chain, ChainNode, Position } from '../calc/chain';
import { nodeRates } from '../calc/rates';
import type { RecipeDb } from '../recipes/db';
import { EU, type ResourceKey } from '../recipes/types';
import { haveBoxes, productOf } from './drive';
import { chainEdges, getId, haveId } from './graphModel';

export const COLUMN = 360;
export const ROW = 220;
const GAP = 40;
/** Rough height of a What I have / What I get box. */
const IO_HEIGHT = 190;

/** Rough rendered height of a machine box: header, machine, count, then a row (plus its buttons) per input/output. */
export function boxHeight(node: ChainNode, db: RecipeDb): number {
  const r = nodeRates(node, db);
  const rows = r.valid ? [...r.perMachine.keys()].filter((k) => k !== EU).length : 1;
  return 150 + 36 * rows;
}

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
  // What I have boxes take the first column; the What I get box goes after the last machine.
  const haves = haveBoxes(chain);
  const shift = haves.length ? 1 : 0;
  const nextY = new Map<number, number>(); // column -> where the next box starts
  const positions: Record<string, Position> = {};
  haves.forEach((h, i) => (positions[haveId(h.key)] = { x: 0, y: i * (IO_HEIGHT + GAP) }));
  const byId = new Map(chain.nodes.map((n) => [n.id, n]));
  let last = -1;
  for (const id of ids) {
    const col = depthOf(id) + shift;
    const y = nextY.get(col) ?? 0;
    nextY.set(col, y + boxHeight(byId.get(id)!, db) + GAP);
    positions[id] = { x: col * COLUMN, y };
    last = Math.max(last, col);
  }
  const product = productOf(chain, db);
  if (product) {
    const maker = chain.nodes.find((n) => {
      const r = nodeRates(n, db);
      return r.valid && (r.perMachine.get(product.key) ?? 0) > 0;
    });
    positions[getId(product.key)] = { x: (last + 1) * COLUMN, y: maker ? positions[maker.id].y : 0 };
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
