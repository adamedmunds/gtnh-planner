import { emptyChain, type Chain, type ChainNode } from '../calc/chain';
import { chainHistoryReducer, chainReducer, initialChainHistory, nextNodeId, type NewNode } from './chainState';

const pos = { x: 0, y: 0 };
const recipe = (sig = 'sig'): NewNode => ({ kind: 'recipe', recipeSig: sig, machineMID: 531, overclock: false, position: pos });
const withNodes = (...nodes: ChainNode[]): Chain => ({ ...emptyChain(), nodes });
const lf = 'fluid:liquid_light_fuel';

test('addNode assigns n1, n2 and skips ids already used', () => {
  const a = chainReducer(emptyChain(), { type: 'addNode', node: recipe() });
  expect(a.nodes.map((n) => n.id)).toEqual(['n1']);
  expect(chainReducer(a, { type: 'addNode', node: recipe() }).nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
  const loaded = withNodes({ ...recipe(), id: 'n7' } as ChainNode, { ...recipe(), id: 'gen' } as ChainNode);
  expect(nextNodeId(loaded)).toBe('n8');
});

test('setTarget replaces the target for the same key', () => {
  let c = chainReducer(emptyChain(), { type: 'setTarget', target: { key: lf, rate: 10 } });
  c = chainReducer(c, { type: 'setTarget', target: { key: lf, maximise: true } });
  expect(c.targets).toEqual([{ key: lf, maximise: true }]);
  expect(chainReducer(c, { type: 'removeTarget', key: lf }).targets).toEqual([]);
});

test('setLimit replaces; removeLimit removes', () => {
  let c = chainReducer(emptyChain(), { type: 'setLimit', key: 'a', maxRate: 1 });
  c = chainReducer(c, { type: 'setLimit', key: 'a', maxRate: 5.57 });
  expect(c.limits).toEqual([{ key: 'a', maxRate: 5.57 }]);
  expect(chainReducer(c, { type: 'removeLimit', key: 'a' }).limits).toEqual([]);
});

test('setExternal on/off is idempotent', () => {
  let c = chainReducer(emptyChain(), { type: 'setExternal', key: 'a', on: true });
  c = chainReducer(c, { type: 'setExternal', key: 'a', on: true });
  expect(c.externals).toEqual(['a']);
  expect(chainReducer(c, { type: 'setExternal', key: 'a', on: false }).externals).toEqual([]);
});

test('removeNode drops only that node', () => {
  const c = withNodes({ ...recipe(), id: 'n1' } as ChainNode, { ...recipe(), id: 'n2' } as ChainNode);
  expect(chainReducer(c, { type: 'removeNode', id: 'n1' }).nodes.map((n) => n.id)).toEqual(['n2']);
});

test('arrange moves every listed node and ignores unknown ids', () => {
  const c = withNodes({ ...recipe(), id: 'n1' } as ChainNode, { ...recipe(), id: 'n2' } as ChainNode);
  const out = chainReducer(c, { type: 'arrange', positions: { n1: { x: 5, y: 6 }, nope: { x: 1, y: 1 } } });
  expect(out.nodes.map((n) => n.position)).toEqual([{ x: 5, y: 6 }, pos]);
  expect(chainReducer(c, { type: 'moveNode', id: 'n2', position: { x: 9, y: 9 } }).nodes[1].position).toEqual({ x: 9, y: 9 });
});

test('no-op actions return the same chain', () => {
  const c = withNodes({ ...recipe(), id: 'n1' } as ChainNode);
  expect(chainReducer(c, { type: 'setMachine', id: 'nope', machineMID: 1 })).toBe(c);
  expect(chainReducer(c, { type: 'setOverclock', id: 'n1', on: false })).toBe(c);
  expect(chainReducer(c, { type: 'setMachine', id: 'n1', machineMID: 531 })).toBe(c);
  expect(chainReducer(c, { type: 'removeTarget', key: 'x' })).toBe(c);
  expect(chainReducer(c, { type: 'setExternal', key: 'x', on: false })).toBe(c);
});

test('undo/redo restore chains; no-ops add no history', () => {
  let h = initialChainHistory();
  h = chainHistoryReducer(h, { type: 'addNode', node: recipe() });
  h = chainHistoryReducer(h, { type: 'setTarget', target: { key: lf, rate: 1 } });
  const before = h.past.length;
  h = chainHistoryReducer(h, { type: 'removeTarget', key: 'nope' });
  expect(h.past.length).toBe(before);
  h = chainHistoryReducer(h, { type: 'undo' });
  expect(h.present.targets).toEqual([]);
  expect(h.present.nodes).toHaveLength(1);
  h = chainHistoryReducer(h, { type: 'redo' });
  expect(h.present.targets).toEqual([{ key: lf, rate: 1 }]);
});

test('load is undoable', () => {
  const a = withNodes({ ...recipe('a'), id: 'n1' } as ChainNode);
  const b = withNodes({ ...recipe('b'), id: 'n1' } as ChainNode);
  let h = initialChainHistory(a);
  h = chainHistoryReducer(h, { type: 'load', chain: b });
  expect(h.present).toBe(b);
  expect(chainHistoryReducer(h, { type: 'undo' }).present).toBe(a);
});
