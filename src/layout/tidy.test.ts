import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { CATALOG } from '../catalog';
import { computeConnections } from '../model/connections';
import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock } from '../model/types';
import { buildLine } from './build';
import { checkLine } from './check';
import { planLine } from './plan';
import { FLOOR_NOTE } from './tidy';
import type { LinePlan } from './types';

let plan: LinePlan;
let line: Build;
beforeAll(async () => {
  const p = planLine(reference(), db, await solveForScreen(reference(), db, await createHighsSolver()), 'modular');
  if ('error' in p) throw new Error(p.error);
  plan = p;
  line = buildLine(plan, 'Light Fuel line').build;
});

const isConduit = (b?: PlacedBlock) => !!b && ['cable', 'fluidPipe', 'itemPipe'].includes(CATALOG.get(b.key)!.kind);
const isFeed = (b: PlacedBlock) => b.pos[1] === 1 && Math.abs(b.pos[2]) === 2;

/** Where each slice's machine columns are (outside them: service columns and the core). */
function inMachineColumns(build: Build, x: number): boolean {
  const g = build.generated!;
  const starts = [
    ...Array.from({ length: g.left }, (_, k) => g.leftStart + k * g.sliceLength),
    ...Array.from({ length: g.right }, (_, k) => g.rightStart + k * g.sliceLength),
  ];
  return starts.some((s) => x >= s && x < s + g.serviceFrom!);
}

test('the oil line is tidy: passes the checker, straight runs outside service columns and the core', () => {
  expect(checkLine(line, plan)).toEqual([]);
  expect(line.generated?.serviceFrom).toBeDefined();
  const cells = new Map(line.blocks.map((b) => [posKey(b.pos), b]));
  const masks = computeConnections(line.blocks);
  for (const b of line.blocks) {
    if (!isConduit(b) || !inMachineColumns(line, b.pos[0])) continue;
    DIRS.forEach((d, side) => {
      if (side >= 4 || !((masks.get(posKey(b.pos)) ?? 0) & (1 << side))) return;
      const n = cells.get(posKey(addVec(b.pos, d)));
      const ok = (n && !isConduit(n)) || (n && (isFeed(b) || isFeed(n)) && b.net?.startsWith('p:') && n.net?.startsWith('p:'));
      expect(ok, `${b.key} at ${b.pos} connects ${side} to ${n?.key}`).toBe(true);
    });
  }
});

test('the oil line fits the tidy cross-section and says what to dig', () => {
  const span = (a: number) => Math.max(...line.blocks.map((b) => b.pos[a])) - Math.min(...line.blocks.map((b) => b.pos[a])) + 1;
  expect(span(2)).toBeLessThanOrEqual(7);
  expect(span(1)).toBeLessThanOrEqual(5);
  expect(line.notes).toContain(FLOOR_NOTE);
  expect(line.notes?.join(' ')).not.toMatch(/fall short/);
});
