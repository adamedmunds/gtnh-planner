import type { PlanMachine } from './types';

/** 0 north lower, 1 north upper, 2 south lower, 3 south upper. */
export type RowId = 0 | 1 | 2 | 3;
/** Where each row's machines sit: side of the walkway (north −1, south +1) and height. */
export const ROWS: readonly { side: -1 | 1; y: 0 | 2 }[] = [
  { side: -1, y: 0 },
  { side: -1, y: 2 },
  { side: 1, y: 0 },
  { side: 1, y: 2 },
];

/** A run of machines of one kind, side by side in one row from column `x0`. */
export interface Stretch { row: RowId; x0: number; count: number; machine: PlanMachine }
export interface Arrangement {
  columns: number;
  stretches: Stretch[];
  /** Columns left empty beside machines that need a side face (pipes may turn there, as in a service column). */
  gaps?: number[];
}

const MAX_CANDIDATES = 12;
const MAX_PERMUTED_KINDS = 6;

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** Machines that take power (generators make it; multiblocks never sit in rows, and stand-ins take none). */
const consumes = (m: PlanMachine) => !m.generator && !m.multiblock;

/**
 * Packs kinds in `order` into four rows of `columns` cells, left to right. A kind either continues in the current row
 * or (when `fresh` says so) starts on the next empty row; a kind longer than a row spills into the next row.
 */
function pack(order: PlanMachine[], fresh: boolean[], columns: number, rowSet: readonly RowId[], sideFaces: ReadonlyMap<string, number>, gaps: Set<number>): Stretch[] | undefined {
  const stretches: Stretch[] = [];
  let row = 0;
  let x = 0;
  for (const [i, m] of order.entries()) {
    if (fresh[i] && x > 0) {
      row++;
      x = 0;
    }
    // A machine that needs side faces stands alone, with an empty block of its own after it (and before it, for two).
    const sides = sideFaces.get(m.nodeId) ?? 0;
    if (sides > 0) {
      for (let k = 0; k < m.count; k++) {
        if (sides > 1 && x === 0) x = 1;
        if (x + 1 > columns || (sides > 1 && x + 1 >= columns)) {
          row++;
          x = sides > 1 ? 1 : 0;
        }
        if (row >= rowSet.length || x >= columns) return undefined;
        stretches.push({ row: rowSet[row], x0: x, count: 1, machine: m });
        if (x + 1 < columns) gaps.add(x + 1);
        if (sides > 1) gaps.add(x - 1);
        x += sides > 1 ? 3 : 2;
      }
      continue;
    }
    let left = m.count;
    while (left > 0) {
      if (x >= columns) {
        row++;
        x = 0;
      }
      if (row >= rowSet.length) return undefined;
      const n = Math.min(left, columns - x);
      stretches.push({ row: rowSet[row], x0: x, count: n, machine: m });
      x += n;
      left -= n;
    }
  }
  return stretches;
}

/** Both rows of a side carry machines of one voltage. */
function oneTierPerSide(stretches: Stretch[]): boolean {
  return [-1, 1].every((side) =>
    new Set(stretches.filter((s) => ROWS[s.row].side === side && consumes(s.machine)).map((s) => s.machine.tier)).size <= 1);
}

const score = (a: Arrangement) => {
  const perRow = new Map<number, number>();
  for (const s of a.stretches) perRow.set(s.row, (perRow.get(s.row) ?? 0) + 1);
  const shared = [...perRow.values()].filter((n) => n > 1).length;
  return [a.columns, a.stretches.length, shared];
};

/**
 * Candidate arrangements, best first: fewest columns, then fewest stretches, then fewest rows shared by two kinds; or,
 * with `unmixed`, fewest shared rows first (every run straight through, at the cost of a longer slice). `rowSet` picks the
 * rows to fill (e.g. only the lower rows, leaving the upper level for pipes); `sideFaces` gives machines that need side
 * faces (more inputs/outputs than their two runs) gaps beside them.
 */
export function arrangeRows(
  machines: PlanMachine[], maxColumns?: number, unmixed = false, rowSet: readonly RowId[] = [0, 1, 2, 3],
  sideFaces: ReadonlyMap<string, number> = new Map(),
): Arrangement[] {
  const kinds = machines.filter((m) => m.count > 0);
  const total = kinds.reduce((n, m) => n + m.count * (1 + Math.min(2, sideFaces.get(m.nodeId) ?? 0)), 0);
  if (!total) return [];
  const minColumns = Math.ceil(total / rowSet.length);
  const orders = kinds.length <= MAX_PERMUTED_KINDS ? permutations(kinds) : [kinds];
  const seen = new Set<string>();
  const out: Arrangement[] = [];
  for (let columns = minColumns; columns <= (maxColumns ?? minColumns + 3); columns++) {
    for (const order of orders) {
      for (let bits = 0; bits < 1 << order.length; bits++) {
        const gaps = new Set<number>();
        const stretches = pack(order, order.map((_, i) => !!(bits & (1 << i))), columns, rowSet, sideFaces, gaps);
        if (!stretches || !oneTierPerSide(stretches)) continue;
        const sig = `${columns}|${stretches.map((s) => `${s.row}.${s.x0}.${s.count}.${s.machine.nodeId}`).sort().join(',')}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({ columns, stretches, ...(gaps.size ? { gaps: [...gaps].sort((a, b) => a - b) } : {}) });
      }
    }
  }
  const cmp = (a: number[], b: number[]) => a.findIndex((v, i) => v !== b[i]);
  return out
    .sort((a, b) => {
      const order = (v: number[]) => (unmixed ? [v[2], v[0], v[1]] : v);
      const sa = order(score(a));
      const sb = order(score(b));
      const i = cmp(sa, sb);
      return i < 0 ? 0 : sa[i] - sb[i];
    })
    .slice(0, MAX_CANDIDATES);
}

