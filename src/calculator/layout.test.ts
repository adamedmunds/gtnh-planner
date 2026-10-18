import { emptyChain, type Chain, type ChainNode } from '../calc/chain';
import { K } from '../test/oilBerryDb';
import { chainReducer } from './chainState';
import { COLUMN, ROW, autoArrange, placeNewNode } from './layout';
import { db, reference, rn } from './testChains';

const at = (n: ChainNode, x: number, y: number): ChainNode => ({ ...n, position: { x, y } });
const chainOf = (...nodes: ChainNode[]): Chain => ({ ...emptyChain(), nodes });

test('oil line arranges left to right', () => {
  const p = autoArrange(reference(), db);
  expect(p.fe.x).toBeLessThan(p.dist.x);
  expect(p.dist.x).toBeLessThan(p.cr.x);
  expect(p.cr.x).toBeLessThan(p.el.x);
  expect(p.gen.x).toBe(p.el.x);
  expect(p.gen.y).not.toBe(p.el.y);
  // The Oil Berry have box takes the first column.
  expect(p.fe).toEqual({ x: COLUMN, y: 0 });
  expect(p.dist.x).toBe(2 * COLUMN);
});

test('a cycle does not hang and every node gets a position', () => {
  const p = autoArrange(chainOf(rn('cr', 3, 421), rn('el', 4, 372)), db);
  expect(p.cr).toBeDefined();
  expect(p.el).toBeDefined();
  expect(p.cr.x).not.toBe(p.el.x);
});

test('a new producer goes left of its consumer', () => {
  const chain = chainOf(at(rn('dist', 1, 531), 500, 40));
  expect(placeNewNode(chain, db, { inputs: [K.oilBerry], outputs: [K.oil] })).toEqual({ x: 500 - COLUMN, y: 40 });
});

test('a new consumer goes right of its producer', () => {
  const chain = chainOf(at(rn('fe', 0, 511), 0, 0));
  expect(placeNewNode(chain, db, { inputs: [K.oil], outputs: [K.sulfuricLightFuel] })).toEqual({ x: COLUMN, y: 0 });
});

test('unrelated goes below everything; an empty chain starts at the origin', () => {
  const chain = chainOf(at(rn('fe', 0, 511), 0, 0), at(rn('dist', 1, 531), 360, 100));
  expect(placeNewNode(chain, db, { inputs: ['item:x@0'], outputs: ['item:y@0'] })).toEqual({ x: 0, y: 100 + ROW });
  expect(placeNewNode(emptyChain(), db, { inputs: [], outputs: [] })).toEqual({ x: 0, y: 0 });
});

test('placement avoids sitting on a node', () => {
  const chain = chainOf(at(rn('dist', 1, 531), 500, 40), at(rn('cr', 3, 421), 500 - COLUMN, 40));
  const p = placeNewNode(chain, db, { inputs: [K.oilBerry], outputs: [K.oil] });
  expect(p.x).toBe(500 - COLUMN);
  for (const n of chain.nodes) expect(Math.hypot(n.position.x - p.x, n.position.y - p.y)).toBeGreaterThanOrEqual(100);
});

test('layout: have boxes left of every machine, the get box right of every machine', () => {
  const chain: Chain = { ...reference(), externals: [K.oilBerry] };
  const p = autoArrange(chain, db);
  const machineXs = chain.nodes.map((n) => p[n.id].x);
  expect(p[`have:${K.oilBerry}`].x).toBeLessThan(Math.min(...machineXs));
  expect(p[`get:${K.lightFuel}`].x).toBeGreaterThan(Math.max(...machineXs));
});

test('arrange stores box positions in chain.layout', () => {
  const chain: Chain = { ...reference(), externals: [K.oilBerry] };
  const next = chainReducer(chain, { type: 'arrange', positions: autoArrange(chain, db) });
  expect(next.layout?.[`have:${K.oilBerry}`]).toEqual({ x: 0, y: 0 });
  expect(next.layout?.[`get:${K.lightFuel}`]).toBeDefined();
  expect(chainReducer(emptyChain(), { type: 'arrange', positions: { 'get:x': { x: 1, y: 1 } } }).layout).toEqual({ 'get:x': { x: 1, y: 1 } });
});
