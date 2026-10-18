import { DIRS, addVec, posKey } from './directions';
import type { Vec3 } from './types';

export interface RouteRequest {
  /** One entry per thing to connect; each entry lists the cells where its pipe may sit (e.g. any free face). */
  terminals: readonly (readonly Vec3[])[];
  /** Cells pipes may not occupy (machines, other networks). */
  blocked: ReadonlySet<string>;
  /** Cells pipes may occupy but should avoid if a route of similar length exists. */
  avoid?: ReadonlySet<string>;
  bounds: { min: Vec3; max: Vec3 };
}

export interface RouteResult {
  /** Pipe cells, including the chosen terminal cells. */
  cells: Vec3[];
  /** For each terminal, the candidate cell that was used. */
  chosen: Vec3[];
}

const AVOID_PENALTY = 4;

/**
 * Connects all terminals with few pipe cells: a greedy Steiner-tree heuristic that repeatedly attaches the
 * nearest unconnected terminal to the tree with a shortest path (Dial's algorithm on a unit-cost grid).
 */
export function routeNetwork(req: RouteRequest): RouteResult {
  const { terminals, blocked, bounds } = req;
  const avoid = req.avoid ?? new Set<string>();
  if (terminals.length === 0) return { cells: [], chosen: [] };

  const inBounds = (c: Vec3) =>
    c[0] >= bounds.min[0] && c[0] <= bounds.max[0] &&
    c[1] >= bounds.min[1] && c[1] <= bounds.max[1] &&
    c[2] >= bounds.min[2] && c[2] <= bounds.max[2];
  const free = (c: Vec3) => inBounds(c) && !blocked.has(posKey(c));
  const stepCost = (c: Vec3) => 1 + (avoid.has(posKey(c)) ? AVOID_PENALTY : 0);

  for (const [i, cands] of terminals.entries()) {
    if (!cands.some(free)) throw new Error(`Terminal ${i} is unreachable: no free candidate cell`);
  }

  const tree = new Map<string, Vec3>();
  const chosen: (Vec3 | undefined)[] = terminals.map(() => undefined);
  const remaining = new Set(terminals.map((_, i) => i));

  // Seed: terminal 0's candidates are all possible starting cells.
  remaining.delete(0);
  if (remaining.size === 0) {
    const c = terminals[0].find(free)!;
    return { cells: [c], chosen: [c] };
  }

  let seeds: { cell: Vec3; cost: number }[] = terminals[0].filter(free).map((cell) => ({ cell, cost: stepCost(cell) }));

  while (remaining.size > 0) {
    // Candidate cell -> terminal indexes that accept it.
    const targets = new Map<string, number[]>();
    for (const t of remaining) {
      for (const c of terminals[t]) {
        if (!free(c)) continue;
        const k = posKey(c);
        targets.set(k, [...(targets.get(k) ?? []), t]);
      }
    }

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const cellOf = new Map<string, Vec3>();
    const buckets: string[][] = [];
    const push = (k: string, d: number) => (buckets[d] ??= []).push(k);
    for (const { cell, cost } of seeds) {
      const k = posKey(cell);
      if ((dist.get(k) ?? Infinity) <= cost) continue;
      dist.set(k, cost);
      prev.set(k, null);
      cellOf.set(k, cell);
      push(k, cost);
    }

    let found: string | undefined;
    for (let d = 0; d < buckets.length && found === undefined; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const k = bucket[i];
        if (dist.get(k) !== d) continue;
        if (targets.has(k)) {
          found = k;
          break;
        }
        const cell = cellOf.get(k)!;
        for (const dir of DIRS) {
          const n = addVec(cell, dir);
          if (!free(n)) continue;
          const nk = posKey(n);
          const nd = d + (tree.has(nk) ? 0 : stepCost(n));
          if (nd < (dist.get(nk) ?? Infinity)) {
            dist.set(nk, nd);
            prev.set(nk, k);
            cellOf.set(nk, n);
            push(nk, nd);
          }
        }
      }
    }
    if (found === undefined) {
      throw new Error(`Terminal ${[...remaining][0]} is unreachable from the rest of the network`);
    }

    // Walk back, adding the path to the tree. The first seed reached is terminal 0's chosen cell.
    let k: string | null = found;
    let last = found;
    while (k !== null) {
      tree.set(k, cellOf.get(k)!);
      last = k;
      k = prev.get(k) ?? null;
    }
    if (chosen[0] === undefined) chosen[0] = cellOf.get(last)!;
    for (const t of targets.get(found)!) {
      chosen[t] = cellOf.get(found)!;
      remaining.delete(t);
    }
    seeds = [...tree.values()].map((cell) => ({ cell, cost: 0 }));
  }

  return { cells: [...tree.values()], chosen: chosen as Vec3[] };
}
