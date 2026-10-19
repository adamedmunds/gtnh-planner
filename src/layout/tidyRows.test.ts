import { ROWS, arrangeRows, type Arrangement } from './tidyRows';
import type { PlanMachine } from './types';

const pm = (nodeId: string, tier: string, count: number, generator = false): PlanMachine => ({
  nodeId, key: `${nodeId}_${tier.toLowerCase()}`, machine: { key: nodeId, name: nodeId, mID: 0, tier }, tier, count,
  eut: 30, title: nodeId, kept: [], inputs: [], outputs: [], generator, multiblock: false,
});

/** Consumer tiers on each side (generators don't take power). */
const sideTiers = (a: Arrangement) => [-1, 1].map((side) =>
  new Set(a.stretches.filter((s) => ROWS[s.row].side === side && !s.machine.generator).map((s) => s.machine.tier)));

test('the oil slice fits in two columns with one voltage per side', () => {
  const [best] = arrangeRows([pm('fe', 'LV', 1), pm('dist', 'LV', 3), pm('gen', 'MV', 1, true)]);
  expect(best.columns).toBe(2);
  for (const tiers of sideTiers(best)) expect(tiers.size).toBeLessThanOrEqual(1);
  const placed = best.stretches.reduce((n, s) => n + s.count, 0);
  expect(placed).toBe(5);
});

test('LV and MV machines never share a side', () => {
  const all = arrangeRows([pm('asm', 'LV', 2), pm('el', 'MV', 2)]);
  expect(all.length).toBeGreaterThan(0);
  for (const a of all) for (const tiers of sideTiers(a)) expect(tiers.size).toBeLessThanOrEqual(1);
});

test('six kinds of one machine each share rows in two columns', () => {
  const [best] = arrangeRows(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => pm(k, 'LV', 1)));
  expect(best.columns).toBe(2);
  const perRow = new Map<number, number>();
  for (const s of best.stretches) perRow.set(s.row, (perRow.get(s.row) ?? 0) + 1);
  expect(Math.max(...perRow.values())).toBe(2);
});

test('stretches never overlap and stay inside the columns', () => {
  for (const a of arrangeRows([pm('fe', 'LV', 3), pm('dist', 'LV', 9), pm('gen', 'MV', 2, true)])) {
    const taken = new Set<string>();
    for (const s of a.stretches) for (let x = s.x0; x < s.x0 + s.count; x++) {
      expect(x).toBeLessThan(a.columns);
      const k = `${s.row}:${x}`;
      expect(taken.has(k)).toBe(false);
      taken.add(k);
    }
  }
});
