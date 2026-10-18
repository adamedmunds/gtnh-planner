import { emptyChain, type Chain } from '../calc/chain';
import { K } from '../test/oilBerryDb';
import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from './drive';
import { boxViews, chainEdges, nodeView, screenEdges } from './graphModel';
import { db, gen, line, reference, rn, solve } from './testChains';

const within = (actual: number, expected: number, pct = 0.5) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * (pct / 100));
const viewOf = async (chain: Chain, id: string) => {
  const result = await solve(chain);
  return nodeView(chain.nodes.find((n) => n.id === id)!, chain, db, result.nodes.find((n) => n.id === id));
};

test('distillery card shows solved totals', async () => {
  const v = await viewOf(reference(), 'dist');
  expect(v.title).toBe('Distillery');
  expect(v.build).toBe(17);
  expect(v.inputs.map((r) => r.key)).toEqual([K.oil]);
  within(v.inputs[0].rate, 557);
  within(v.outputs.find((r) => r.key === K.sulfuricLightFuel)!.rate, 557);
  expect(v.overclock).toBe(false);
});

test('an unsolved card shows per-machine rates and flags unmet inputs', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('fe', 0, 511)] };
  const v = nodeView(chain.nodes[0], chain, db);
  expect(v.inputs).toEqual([{ key: K.oilBerry, name: 'Oil Berry', kind: 'item', rate: 1, unmet: true, external: false, actions: ['make', 'have'] }]);
  expect(v.outputs[0]).toMatchObject({ key: K.oil, rate: 100, unmet: false });
  expect(v.eut).toBe(30);
});

test('externals are marked on rows', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('fe', 0, 511)], externals: [K.oilBerry] };
  expect(nodeView(chain.nodes[0], chain, db).inputs[0].external).toBe(true);
});

test('an electrolyzer card offers machines that can run it, plus the current one', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('el', 4, 371)] };
  const v = nodeView(chain.nodes[0], chain, db);
  expect(v.machineOptions.map((m) => m.mID).sort()).toEqual([371, 372]);
  expect(v.invalid).toBe('machine tier too low');
});

test('a node whose recipe is gone is invalid but still has a view', () => {
  const chain: Chain = { ...emptyChain(), nodes: [{ ...rn('x', 0, 511), recipeSig: 'gone' }] as Chain['nodes'] };
  const v = nodeView(chain.nodes[0], chain, db);
  expect(v.invalid).toBe('missing recipe');
  expect(v.title).toBe('Missing recipe');
  expect(v.inputs).toEqual([]);
});

test('generator card', async () => {
  const v = await viewOf(reference(), 'gen');
  expect(v.kind).toBe('generator');
  expect(v.title).toBe('Light Fuel → EU');
  expect(v.machineOptions.map((m) => m.mID)).toEqual([1110, 1111]);
  within(v.inputs[0].rate, 43.74, 1);
});

test('edges link producers to consumers with flows', async () => {
  const chain = reference();
  const edges = chainEdges(chain, db, await solve(chain));
  within(edges.find((e) => e.id === `fe>dist:${K.oil}`)!.flow, 557);
  expect(edges.some((e) => e.source === 'cr' && e.target === 'el')).toBe(true);
  expect(edges.some((e) => e.source === 'el' && e.target === 'cr')).toBe(true);
  expect(edges.some((e) => e.key === K.eu)).toBe(false);
  expect(edges.some((e) => e.source === 'cr' && e.target === 'gen' && e.key === K.lightFuel)).toBe(true);
});

test('edges exist with zero flow before a solve', () => {
  const chain: Chain = { ...emptyChain(), nodes: line() };
  expect(chainEdges(chain, db).find((x) => x.id === `fe>dist:${K.oil}`)?.flow).toBe(0);
});

test('a lone generator has no edges', () => {
  expect(chainEdges({ ...emptyChain(), nodes: [gen] }, db)).toEqual([]);
});

describe('screen boxes', () => {
  const screen = async (chain: Chain) => solveForScreen(chain, db, await createHighsSolver());

  test('reference: one have box and a get box', async () => {
    const chain = { ...reference(), externals: [K.oilBerry] };
    const b = boxViews(chain, db, await screen(chain));
    expect(b.haves).toEqual([expect.objectContaining({ id: `have:${K.oilBerry}`, key: K.oilBerry, name: 'Oil Berry', amount: 5.57 })]);
    within(b.haves[0].used, 5.57);
    expect(b.get).toMatchObject({ id: `get:${K.lightFuel}`, key: K.lightFuel, provisional: false });
    within(b.get!.rate, 513.25);
    expect(b.get!.typed).toBeUndefined();
  });

  test('Also made lists Sulfur Dust, not the product', async () => {
    const chain = reference();
    const b = boxViews(chain, db, await screen(chain));
    expect(b.alsoMade.map((r) => r.key)).toEqual([K.sulfur]);
  });

  test('row actions: unmet input → make/have; outputs → use/want, no want on the product', () => {
    const chain: Chain = { ...emptyChain(), nodes: [rn('cr', 3, 421)], targets: [{ key: K.lightFuel, maximise: true }] };
    const v = nodeView(chain.nodes[0], chain, db, undefined, K.lightFuel);
    expect(v.inputs.find((r) => r.key === K.hydrogenCell)!.actions).toEqual(['make', 'have']);
    expect(v.outputs.find((r) => r.key === K.lightFuel)!.actions).toEqual(['use']);
    expect(v.outputs.find((r) => r.key === K.h2sCell)!.actions).toEqual(['use', 'want']);
    expect(v.tier).toBe('LV');
    expect(v.machineIcon).toBe('item:gregtech:gt.blockmachines@421');
  });

  test('an input you have shows no make/have buttons', () => {
    const chain: Chain = { ...emptyChain(), nodes: [rn('fe', 0, 511)], externals: [K.oilBerry] };
    expect(nodeView(chain.nodes[0], chain, db).inputs[0].actions).toEqual([]);
  });

  test('edges from the have box and into the get box', async () => {
    const chain = { ...reference(), externals: [K.oilBerry] };
    const edges = screenEdges(chain, db, await screen(chain));
    within(edges.find((e) => e.source === `have:${K.oilBerry}` && e.target === 'fe')!.flow, 5.57);
    within(edges.find((e) => e.source === 'cr' && e.target === `get:${K.lightFuel}`)!.flow, 513.25);
  });
});
