import { DIRS, addVec, posKey } from './directions';
import type { Vec3 } from './types';

export interface RouteRequest {
  /** One entry per thing to connect; each entry lists the cells where its pipe may sit (e.g. any free face). */
  terminals: readonly (readonly Vec3[])[];
  /** Cells pipes may not occupy (machines, other networks). */
  blocked: ReadonlySet<string>;
  /** Cells pipes may occupy but should avoid if a route of similar length exists. */
  avoid?: ReadonlySet<string>;
  /** Extra cost of stepping onto an avoided cell (default 4). */
  avoidPenalty?: number;
  /** Only moves this allows are taken (e.g. leave a straight run only in a service column). */
  canStep?: (from: Vec3, to: Vec3) => boolean;
  /** Extra cost each time a path changes direction (default 0), so routes come out as straight runs. */
  bendPenalty?: number;
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
  const penalty = req.avoidPenalty ?? AVOID_PENALTY;
  const bend = req.bendPenalty ?? 0;
  const canStep = req.canStep ?? (() => true);
  const stepCost = (c: Vec3) => 1 + (avoid.has(posKey(c)) ? penalty : 0);

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

    // Search states are (cell, direction it was entered from) so bends can cost extra; -1 = a starting cell.
    const stateKey = (k: string, dir: number) => (bend ? `${k}|${dir}` : k);
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const cellOf = new Map<string, Vec3>();
    const dirOf = new Map<string, number>();
    const buckets: string[][] = [];
    const push = (k: string, d: number) => (buckets[d] ??= []).push(k);
    for (const { cell, cost } of seeds) {
      const k = stateKey(posKey(cell), -1);
      if ((dist.get(k) ?? Infinity) <= cost) continue;
      dist.set(k, cost);
      prev.set(k, null);
      cellOf.set(k, cell);
      dirOf.set(k, -1);
      push(k, cost);
    }

    let found: string | undefined;
    for (let d = 0; d < buckets.length && found === undefined; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const k = bucket[i];
        if (dist.get(k) !== d) continue;
        const cell = cellOf.get(k)!;
        if (targets.has(posKey(cell))) {
          found = k;
          break;
        }
        const from = dirOf.get(k)!;
        DIRS.forEach((dir, di) => {
          const n = addVec(cell, dir);
          if (!free(n) || !canStep(cell, n)) return;
          const nk = posKey(n);
          const turn = bend && from >= 0 && from !== di ? bend : 0;
          const nd = d + (tree.has(nk) ? 0 : stepCost(n)) + turn;
          const ns = stateKey(nk, di);
          if (nd < (dist.get(ns) ?? Infinity)) {
            dist.set(ns, nd);
            prev.set(ns, k);
            cellOf.set(ns, n);
            dirOf.set(ns, di);
            push(ns, nd);
          }
        });
      }
    }
    if (found === undefined) {
      throw new Error(`Terminal ${[...remaining][0]} is unreachable from the rest of the network`);
    }

    // Walk back, adding the path to the tree. The first seed reached is terminal 0's chosen cell.
    let k: string | null = found;
    let last = found;
    while (k !== null) {
      const c = cellOf.get(k)!;
      tree.set(posKey(c), c);
      last = k;
      k = prev.get(k) ?? null;
    }
    if (chosen[0] === undefined) chosen[0] = cellOf.get(last)!;
    const reached = cellOf.get(found)!;
    for (const t of targets.get(posKey(reached))!) {
      chosen[t] = reached;
      remaining.delete(t);
    }
    seeds = [...tree.values()].map((cell) => ({ cell, cost: 0 }));
  }

  return { cells: [...tree.values()], chosen: chosen as Vec3[] };
}
