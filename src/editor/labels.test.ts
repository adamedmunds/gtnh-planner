import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { buildLine } from '../layout/build';
import { planLine } from '../layout/plan';
import type { LinePlan } from '../layout/types';
import { posKey } from '../model/directions';
import type { Build } from '../model/types';
import { labelSpots, networkMembers } from './labels';

let line: Build;
beforeAll(async () => {
  const chain = reference();
  const plan = planLine(chain, db, await solveForScreen(chain, db, await createHighsSolver()), 'modular') as LinePlan;
  line = buildLine(plan, 'Light Fuel line').build;
});

test('labels sit on long pipe runs, about once per slice, never more than the line can show', () => {
  const spots = labelSpots(line);
  const ids = new Set(line.networks!.map((n) => n.id));
  expect(spots.length).toBeGreaterThan(0);
  for (const s of spots) expect(ids.has(s.net)).toBe(true);
  expect(spots.length).toBeLessThanOrEqual(line.networks!.length * (line.generated!.sliceCount + 2));
  // Above a pipe of its own network.
  for (const s of spots) {
    const below = line.blocks.find((b) => b.pos[0] === s.pos[0] && b.pos[1] === s.pos[1] && b.pos[2] === s.pos[2]);
    expect(below?.net).toBe(s.net);
  }
});

test('no labels for builds without networks', () => {
  expect(labelSpots({ version: 1, name: 'x', blocks: [{ pos: [0, 0, 0], key: 'bronze_pipe_small' }] })).toEqual([]);
});

test('a network is its pipes plus the machines they connect to', () => {
  const oil = line.networks!.find((n) => n.name === 'Oil')!;
  const members = networkMembers(line.blocks, oil.id);
  const pipes = line.blocks.filter((b) => b.net === oil.id);
  for (const p of pipes) expect(members.has(posKey(p.pos))).toBe(true);
  const machines = line.blocks.filter((b) => members.has(posKey(b.pos)) && !b.net);
  expect(machines.some((m) => m.key === 'fluid_extractor_lv')).toBe(true);
  expect(machines.some((m) => m.key === 'distillery_lv')).toBe(true);
  expect(machines.some((m) => m.key === 'chemical_reactor_lv')).toBe(false);
});
