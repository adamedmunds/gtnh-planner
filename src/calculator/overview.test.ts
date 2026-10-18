import { emptyChain, type Chain } from '../calc/chain';
import { K } from '../test/oilBerryDb';
import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from './drive';
import { overview, summary } from './overview';
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

test('an extra problem from the solve is listed first', async () => {
  const chain = reference();
  const o = overview(chain, db, await solve(chain), 'Set a supply limit for Oil Berry to maximise Light Fuel.');
  expect(o.problems).toEqual(['Set a supply limit for Oil Berry to maximise Light Fuel.']);
});

describe('summary', () => {
  const screen = async (chain: Chain) => solveForScreen(chain, db, await createHighsSolver());

  test('reference summary in plain sections', async () => {
    const chain = reference();
    const s = summary(chain, db, await screen(chain));
    expect(s.haves.map((r) => r.name)).toEqual(['Oil Berry']);
    expect(s.gets.map((r) => r.name)).toEqual(['Light Fuel']);
    expect(s.alsoMade.map((r) => r.name)).toEqual(['Sulfur Dust']);
    expect(s.machines).toContainEqual({ name: 'Basic Distillery', tier: 'LV', icon: 'item:gregtech:gt.blockmachines@531', build: 17, exact: expect.any(Number) });
    expect(s.power.outside).toBe(0);
    expect(s.problems).toEqual([]);
  });

  test('power from outside = used − made when positive', async () => {
    const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, rate: 100 }] };
    const s = summary(chain, db, await screen(chain));
    within(s.power.outside, 107.6);
  });
});
