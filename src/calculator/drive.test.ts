import { emptyChain, type Chain } from '../calc/chain';
import { createHighsSolver } from '../calc/solver/highs';
import type { LpSolver } from '../calc/solver/types';
import { K } from '../test/oilBerryDb';
import { driveText, haveBoxes, normalizeChain, productOf, screenProblems, solveForScreen } from './drive';
import { db, gen, line, reference, rn } from './testChains';

let solver: LpSolver;
beforeAll(async () => {
  solver = await createHighsSolver();
});

const within = (actual: number, expected: number, pct = 0.5) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * (pct / 100));
const machines = (s: { result: { nodes: { id: string; machines: number }[] } }, id: string) =>
  s.result.nodes.find((n) => n.id === id)!.machines;

test('normalizeChain keeps the first target only', () => {
  const c: Chain = { ...emptyChain(), targets: [{ key: 'a', rate: 1 }, { key: 'b', maximise: true }] };
  expect(normalizeChain(c).targets).toEqual([{ key: 'a', rate: 1 }]);
  const one = { ...emptyChain(), targets: [{ key: 'a', rate: 1 }] };
  expect(normalizeChain(one)).toBe(one);
});

test('haveBoxes lists bought-in inputs, then other limits, with amounts', () => {
  const c: Chain = { ...emptyChain(), externals: ['x', 'y'], limits: [{ key: 'y', maxRate: 2 }, { key: 'z', maxRate: 3 }] };
  expect(haveBoxes(c)).toEqual([{ key: 'x' }, { key: 'y', amount: 2 }, { key: 'z', amount: 3 }]);
});

test("productOf: the want, else the newest node's unconsumed output", () => {
  expect(productOf({ ...emptyChain(), nodes: [rn('fe', 0, 511)] }, db)).toEqual({ key: K.oil, provisional: true });
  expect(productOf({ ...emptyChain(), nodes: [rn('fe', 0, 511), rn('dist', 1, 531)] }, db)).toEqual({ key: K.sulfuricLightFuel, provisional: true });
  expect(productOf({ ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, maximise: true }] }, db)).toEqual({ key: K.lightFuel, provisional: false });
  expect(productOf(emptyChain(), db)).toBeUndefined();
});

test('nothing typed: one machine of the product step', async () => {
  const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, maximise: true }] };
  const s = await solveForScreen(chain, db, solver);
  expect(s.mode).toBe('oneMachine');
  within(machines(s, 'cr'), 1);
  expect(driveText(s, chain, db)).toBe('Showing one Basic Chemical Reactor — type how much you have or want');
});

test('an unrelated have amount still shows one machine', async () => {
  const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, maximise: true }], externals: ['item:x@0'], limits: [{ key: 'item:x@0', maxRate: 3 }] };
  expect((await solveForScreen(chain, db, solver)).mode).toBe('oneMachine');
});

test('a have amount drives the reference line', async () => {
  const chain = reference();
  const s = await solveForScreen(chain, db, solver);
  expect(s.mode).toBe('max');
  within(s.result.outputs.get(K.lightFuel)!, 513.25);
  expect(driveText(s, chain, db)).toBe('Making as much Light Fuel as 5.57 Oil Berry/s allows');
  expect(screenProblems(s, chain, db)).toEqual([]);
});

test('several caps are all named', async () => {
  const chain: Chain = { ...reference(), nodes: [rn('fe', 0, 511), { ...rn('dist', 1, 531), maxMachines: 4 }, rn('cr', 3, 421), rn('el', 4, 372), gen] };
  const s = await solveForScreen(chain, db, solver);
  expect(driveText(s, chain, db)).toBe('Making as much Light Fuel as 5.57 Oil Berry/s and 4 Basic Distillery allow');
});

test('1000 L/s names the berries with what is needed', async () => {
  const chain: Chain = { ...reference(), targets: [{ key: K.lightFuel, rate: 1000 }] };
  const s = await solveForScreen(chain, db, solver);
  expect(s.mode).toBe('exact');
  expect(s.shortfalls).toHaveLength(1);
  expect(s.shortfalls[0]).toMatchObject({ kind: 'have', key: K.oilBerry, have: 5.57 });
  expect(screenProblems(s, chain, db)[0]).toMatch(/^Needs 10\.\d+ Oil Berry\/s — you have 5\.57$/);
  expect(driveText(s, chain, db)).toBe('Making 1,000 L/s Light Fuel');
});

test('a machine count that falls short is named', async () => {
  const chain: Chain = {
    ...emptyChain(),
    nodes: [rn('fe', 0, 511), { ...rn('dist', 1, 531), maxMachines: 4 }, rn('cr', 3, 421), rn('el', 4, 372)],
    targets: [{ key: K.lightFuel, rate: 1000 }],
  };
  const s = await solveForScreen(chain, db, solver);
  expect(s.shortfalls).toEqual([expect.objectContaining({ kind: 'machines', id: 'dist', have: 4 })]);
  expect(screenProblems(s, chain, db)[0]).toMatch(/^Needs 30 Basic Distillery — you set 4$/);
});

test('problems never use the old jargon', async () => {
  const chain: Chain = { ...reference(), targets: [{ key: K.lightFuel, rate: 1000 }] };
  const s = await solveForScreen(chain, db, solver);
  for (const p of screenProblems(s, chain, db)) expect(p).not.toMatch(/target|limit|maximi[sz]e|bought in/i);
});

test('an invalid machine is listed in plain words', async () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('el', 4, 371)] };
  const s = await solveForScreen(chain, db, solver);
  expect(screenProblems(s, chain, db)).toContain('Basic Electrolyzer: machine tier too low');
});
