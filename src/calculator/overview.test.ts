import { emptyChain, type Chain } from '../calc/chain';
import { K } from '../test/oilBerryDb';
import { overview } from './overview';
import { db, line, reference, rn, solve } from './testChains';

const within = (actual: number, expected: number, pct = 0.5) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * (pct / 100));

test('reference overview', async () => {
  const chain = reference();
  const o = overview(chain, db, await solve(chain));
  expect(o.outputs.map((r) => r.name)).toEqual(['Light Fuel']);
  within(o.outputs[0].rate, 513.25);
  within(o.byproducts.find((r) => r.key === K.sulfur)!.rate, 0.0464);
  expect(o.inputs.map((r) => [r.name, Number(r.rate.toFixed(2))])).toEqual([['Oil Berry', 5.57]]);
  expect(o.machines).toContainEqual(expect.objectContaining({ name: 'Basic Distillery', build: 17 }));
  expect(o.machines.map((m) => m.name)).toEqual([...o.machines.map((m) => m.name)].sort());
  expect(Math.abs(o.power.net)).toBeLessThan(1e-6);
  within(o.power.used, 599.3);
  expect(o.problems).toEqual([]);
});

test('infeasible problems name the limit', async () => {
  const chain: Chain = { ...reference(), targets: [{ key: K.lightFuel, rate: 1000 }] };
  const o = overview(chain, db, await solve(chain));
  expect(o.problems[0]).toMatch(/Oil Berry/);
});

test('an unlimited, non-external input is a problem; marking it bought in clears it', async () => {
  const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, rate: 100 }] };
  const o = overview(chain, db, await solve(chain));
  expect(o.problems).toEqual([expect.stringMatching(/^Oil Berry comes from outside the chain/)]);
  const bought: Chain = { ...chain, externals: [K.oilBerry] };
  expect(overview(bought, db, await solve(bought)).problems).toEqual([]);
});

test('an invalid node is listed as a problem', async () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('el', 4, 371)], targets: [{ key: K.sulfur, rate: 1 }] };
  const o = overview(chain, db, await solve(chain));
  expect(o.problems.some((p) => /Basic Electrolyzer.*machine tier too low/.test(p))).toBe(true);
});

test('no result: empty rows, invalid nodes still listed', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('el', 4, 371)] };
  const o = overview(chain, db);
  expect(o.inputs).toEqual([]);
  expect(o.power).toEqual({ used: 0, made: 0, net: 0 });
  expect(o.problems).toHaveLength(1);
});
