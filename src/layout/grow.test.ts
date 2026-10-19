import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { billOfMaterials } from '../model/editing';
import type { Build } from '../model/types';
import { buildLine } from './build';
import { checkLine } from './check';
import { addSlice, removeSlice, sliceBuild } from './grow';
import { planLine } from './plan';
import type { LinePlan } from './types';

let plan: LinePlan;
let line: Build;
beforeAll(async () => {
  const chain = reference();
  plan = planLine(chain, db, await solveForScreen(chain, db, await createHighsSolver()), 'modular') as LinePlan;
  line = buildLine(plan, 'Light Fuel line').build;
});
const bom = (b: Build) => Object.fromEntries(billOfMaterials(b.blocks).map((l) => [l.key, l.count]));
const sig = (b: Build) => b.blocks.map((x) => JSON.stringify(x)).sort();

test('adding a slice on the right keeps slices identical and the checker happy', () => {
  const grown = addSlice(line, 'right');
  expect(grown.generated).toMatchObject({ sliceCount: 7, right: line.generated!.right + 1, left: line.generated!.left });
  expect(bom(grown)).toMatchObject({ fluid_extractor_lv: 7, distillery_lv: 21 });
  expect(checkLine(grown, plan)).toEqual([]);
  expect(grown.notes).toContain('7 slices · handles 7 Oil Berry/s · paste more slices on either end to grow it');
});

test('adding on the left moves the left edge and stays buildable', () => {
  const grown = addSlice(line, 'left');
  expect(grown.generated!.leftStart).toBe(line.generated!.leftStart - line.generated!.sliceLength);
  expect(checkLine(grown, plan)).toEqual([]);
});

test('remove undoes add exactly', () => {
  for (const end of ['left', 'right'] as const) {
    const back = removeSlice(addSlice(line, end), end);
    expect(sig(back)).toEqual(sig(line));
    expect(back.generated).toEqual(line.generated);
    expect(back.covers).toEqual(line.covers);
  }
});

test('a side with no slices left is not removed from', () => {
  let b = line;
  for (let i = 0; i < 10; i++) b = removeSlice(b, 'left');
  expect(b.generated!.left).toBe(0);
  expect(removeSlice(b, 'left')).toBe(b);
});

test('past what the core serves, the notes say to build a second core', () => {
  let b = line;
  for (let i = 0; i < 10; i++) b = addSlice(b, 'right');
  expect(b.notes?.join(' ')).toMatch(/16 slices.*past that, build a second core/);
});

test('the one-slice build equals slice 0 and says how to line it up', () => {
  const one = sliceBuild(line);
  expect(sig(one)).toEqual(line.generated!.template.map((x) => JSON.stringify(x)).sort());
  expect(one.notes?.[0]).toMatch(/line it up/i);
  expect(one.generated).toBeUndefined();
});

test('the one-slice export says exactly where its corner goes', () => {
  const one = sliceBuild(line);
  const minY = Math.min(...line.generated!.template.map((b) => b.pos[1]));
  const minZ = Math.min(...line.generated!.template.map((b) => b.pos[2]));
  expect(one.notes![0]).toContain(`${-minY} below`);
  expect(one.notes![0]).toContain(`${-minZ} north`);
});

test('grown slices keep their pipe networks', () => {
  const grown = addSlice(line, 'right');
  const x0 = grown.generated!.rightStart + (grown.generated!.right - 1) * grown.generated!.sliceLength;
  const added = grown.blocks.filter((b) => b.pos[0] >= x0 && /pipe|cable/.test(b.key));
  expect(added.length).toBeGreaterThan(0);
  for (const b of added) expect(b.net).toBeDefined();
});
