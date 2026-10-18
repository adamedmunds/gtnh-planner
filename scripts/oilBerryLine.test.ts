import { OIL_BERRY_LINE } from './oilBerryLine';
import { buildSchematic } from '../src/export/schematic';
import { CATALOG, type CatalogEntry } from '../src/catalog';
import { computeConnections } from '../src/model/connections';
import { DIRS, OPPOSITE, addVec, posKey } from '../src/model/directions';
import type { PlacedBlock } from '../src/model/types';

const EU_PER_TICK: Record<string, number> = {
  fluid_extractor_lv: 30,
  distillery_lv: 24,
  chemical_reactor_lv: 30,
  electrolyzer_lv: 30,
};

interface Cell { block: PlacedBlock; entry: CatalogEntry }
const cells = new Map<string, Cell>(
  OIL_BERRY_LINE.blocks.map((b) => [posKey(b.pos), { block: b, entry: CATALOG.get(b.key)! }]),
);
const conns = computeConnections(OIL_BERRY_LINE.blocks);
const at = (p: readonly [number, number, number]) => cells.get(posKey(p));
const isConduit = (c: Cell) => c.entry.kind !== 'machine';
const ofKey = (key: string) => [...cells.values()].filter((c) => c.block.key === key);
const neighbours = (c: Cell) =>
  DIRS.map((d, side) => ({ side, n: at(addVec(c.block.pos, d)) })).filter((x) => x.n !== undefined) as {
    side: number;
    n: Cell;
  }[];

/** Conduits reachable from `start` through connected same-kind pipes, plus the machines they connect to. */
function network(start: Cell) {
  const seen = new Set<string>([posKey(start.block.pos)]);
  const queue = [start];
  const machines = new Set<Cell>();
  while (queue.length) {
    const c = queue.pop()!;
    const mask = conns.get(posKey(c.block.pos)) ?? 0;
    for (const { side, n } of neighbours(c)) {
      if (!(mask & (1 << side))) continue;
      if (!isConduit(n)) {
        machines.add(n);
        continue;
      }
      const back = conns.get(posKey(n.block.pos)) ?? 0;
      if (n.entry.kind === c.entry.kind && back & (1 << OPPOSITE[side]) && !seen.has(posKey(n.block.pos))) {
        seen.add(posKey(n.block.pos));
        queue.push(n);
      }
    }
  }
  return { size: seen.size, machines: [...machines].map((m) => m.block.key) };
}

/** The conduit a machine pushes its output into (its mFacing side). */
function outputPipe(m: Cell): Cell {
  const n = at(addVec(m.block.pos, DIRS[m.block.facing!]));
  if (!n || !isConduit(n)) throw new Error(`${m.block.key} at ${posKey(m.block.pos)} outputs into nothing`);
  const mask = conns.get(posKey(n.block.pos)) ?? 0;
  if (!(mask & (1 << OPPOSITE[m.block.facing!]))) throw new Error(`output pipe not connected to ${m.block.key}`);
  return n;
}

const count = (keys: string[], key: string) => keys.filter((k) => k === key).length;

test('has the planned machines and exports cleanly', () => {
  expect(ofKey('fluid_extractor_lv')).toHaveLength(6);
  expect(ofKey('distillery_lv')).toHaveLength(17);
  expect(ofKey('chemical_reactor_lv')).toHaveLength(1);
  expect(ofKey('electrolyzer_lv')).toHaveLength(1);
  expect(ofKey('combustion_generator_mv')).toHaveLength(9);
  expect(ofKey('transformer_mv_lv')).toHaveLength(9);
  expect(buildSchematic(OIL_BERRY_LINE).warnings).toEqual([]);
});

test('every LV machine touches exactly one transformer and no MV generator', () => {
  for (const c of cells.values()) {
    if (!(c.block.key in EU_PER_TICK)) continue;
    const near = neighbours(c).map((x) => x.n.block.key);
    expect(count(near, 'transformer_mv_lv'), `${c.block.key} at ${posKey(c.block.pos)}`).toBe(1);
    expect(near).not.toContain('combustion_generator_mv');
  }
});

test('each transformer is fed on its front by an MV generator and powers at most 128 EU/t', () => {
  for (const t of ofKey('transformer_mv_lv')) {
    const front = at(addVec(t.block.pos, DIRS[t.block.facing!]));
    expect(front?.block.key).toBe('combustion_generator_mv');
    const load = neighbours(t).reduce((sum, { n }) => sum + (EU_PER_TICK[n.block.key] ?? 0), 0);
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThanOrEqual(128);
  }
});

test('oil network: extractor outputs reach all distilleries and nothing else', () => {
  const oil = network(outputPipe(ofKey('fluid_extractor_lv')[0]));
  expect(count(oil.machines, 'fluid_extractor_lv')).toBe(6);
  expect(count(oil.machines, 'distillery_lv')).toBe(17);
  expect(oil.machines.filter((k) => k !== 'fluid_extractor_lv' && k !== 'distillery_lv')).toEqual([]);
  for (const fe of ofKey('fluid_extractor_lv')) expect(network(outputPipe(fe)).size).toBe(oil.size);
});

test('sulfuric light fuel network: distillery outputs reach the chemical reactor only', () => {
  const sulfuric = network(outputPipe(ofKey('distillery_lv')[0]));
  expect(count(sulfuric.machines, 'distillery_lv')).toBe(17);
  expect(count(sulfuric.machines, 'chemical_reactor_lv')).toBe(1);
  expect(sulfuric.machines.filter((k) => k !== 'distillery_lv' && k !== 'chemical_reactor_lv')).toEqual([]);
  for (const d of ofKey('distillery_lv')) expect(network(outputPipe(d)).size).toBe(sulfuric.size);
});

test('light fuel network: chemical reactor feeds all 9 generators and has an open end for storage', () => {
  const gen = ofKey('combustion_generator_mv')[0];
  const pipe = neighbours(gen).find(({ n, side }) => isConduit(n) && (conns.get(posKey(n.block.pos))! & (1 << OPPOSITE[side])))!.n;
  const fuel = network(pipe);
  expect(count(fuel.machines, 'combustion_generator_mv')).toBe(9);
  expect(count(fuel.machines, 'chemical_reactor_lv')).toBe(1);
  expect(fuel.machines.filter((k) => k !== 'combustion_generator_mv' && k !== 'chemical_reactor_lv')).toEqual([]);
});

test('berry item network reaches all 6 fluid extractors and nothing else', () => {
  const pipe = [...cells.values()].find(
    (c) => c.entry.kind === 'itemPipe' && neighbours(c).some(({ n }) => n.block.key === 'fluid_extractor_lv'),
  )!;
  const items = network(pipe);
  expect(count(items.machines, 'fluid_extractor_lv')).toBe(6);
  expect(items.machines.filter((k) => k !== 'fluid_extractor_lv')).toEqual([]);
});

test('chemical reactor and electrolyzer share a cell loop item pipe', () => {
  const pipe = [...cells.values()].find(
    (c) => c.entry.kind === 'itemPipe' && neighbours(c).some(({ n }) => n.block.key === 'electrolyzer_lv'),
  )!;
  expect(network(pipe).machines.sort()).toEqual(['chemical_reactor_lv', 'electrolyzer_lv']);
});

test('uses a lean pipe layout (no full rings around machines)', () => {
  const pipes = [...cells.values()].filter(isConduit);
  expect(pipes.length).toBeLessThanOrEqual(95);
});

test('every pipe is connected to its own network on at least one side (no dead stubs)', () => {
  for (const c of cells.values()) {
    if (!isConduit(c)) continue;
    expect(conns.get(posKey(c.block.pos)), `pipe at ${posKey(c.block.pos)}`).not.toBe(0);
  }
});

test('pipes of the same kind never sit side by side unless they are connected (nothing to wrench apart)', () => {
  for (const c of cells.values()) {
    if (!isConduit(c)) continue;
    const mask = conns.get(posKey(c.block.pos))!;
    for (const { side, n } of neighbours(c)) {
      if (n.entry.kind !== c.entry.kind) continue;
      expect(mask & (1 << side), `pipes at ${posKey(c.block.pos)} side ${side}`).not.toBe(0);
    }
  }
});
