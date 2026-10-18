import { emptyChain, type Chain } from '../calc/chain';
import { K } from '../test/oilBerryDb';
import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from './drive';
import { summary } from './overview';
import { db, line, reference } from './testChains';

const within = (actual: number, expected: number, pct = 0.5) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * (pct / 100));

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
