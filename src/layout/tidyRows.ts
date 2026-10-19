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
export interface Arrangement { columns: number; stretches: Stretch[] }

const MAX_CANDIDATES = 12;
const MAX_PERMUTED_KINDS = 6;

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** Machines that take power (generators make it; multiblocks are built by hand). */
const consumes = (m: PlanMachine) => !m.generator && !m.multiblock;

/**
 * Packs kinds in `order` into four rows of `columns` cells, left to right. A kind either continues in the current row
 * or (when `fresh` says so) starts on the next empty row; a kind longer than a row spills into the next row.
 */
function pack(order: PlanMachine[], fresh: boolean[], columns: number): Stretch[] | undefined {
  const stretches: Stretch[] = [];
  let row = 0;
  let x = 0;
  for (const [i, m] of order.entries()) {
    if (fresh[i] && x > 0) {
      row++;
      x = 0;
    }
    let left = m.count;
    while (left > 0) {
      if (x >= columns) {
        row++;
        x = 0;
      }
      if (row > 3) return undefined;
      const n = Math.min(left, columns - x);
      stretches.push({ row: row as RowId, x0: x, count: n, machine: m });
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

/** Candidate arrangements, best first: fewest columns, then fewest stretches, then fewest rows shared by two kinds. */
export function arrangeRows(machines: PlanMachine[], maxColumns?: number): Arrangement[] {
  const kinds = machines.filter((m) => m.count > 0);
  const total = kinds.reduce((n, m) => n + m.count, 0);
  if (!total) return [];
  const minColumns = Math.ceil(total / 4);
  const orders = kinds.length <= MAX_PERMUTED_KINDS ? permutations(kinds) : [kinds];
  const seen = new Set<string>();
  const out: Arrangement[] = [];
  for (let columns = minColumns; columns <= (maxColumns ?? minColumns + 2); columns++) {
    for (const order of orders) {
      for (let bits = 0; bits < 1 << order.length; bits++) {
        const stretches = pack(order, order.map((_, i) => !!(bits & (1 << i))), columns);
        if (!stretches || !oneTierPerSide(stretches)) continue;
        const sig = `${columns}|${stretches.map((s) => `${s.row}.${s.x0}.${s.count}.${s.machine.nodeId}`).sort().join(',')}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({ columns, stretches });
      }
    }
  }
  const cmp = (a: number[], b: number[]) => a.findIndex((v, i) => v !== b[i]);
  return out
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      const i = cmp(sa, sb);
      return i < 0 ? 0 : sa[i] - sb[i];
    })
    .slice(0, MAX_CANDIDATES);
}
