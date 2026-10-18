import { emptyChain, type Chain } from '../calc/chain';
import { CHAIN_KEY, loadChain, saveChain } from './chainStorage';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const chain: Chain = {
  ...emptyChain(),
  nodes: [{ id: 'n1', kind: 'recipe', recipeSig: 's', machineMID: 531, overclock: true, position: { x: 1, y: 2 } }],
  targets: [{ key: 'fluid:liquid_light_fuel', maximise: true }],
  limits: [{ key: 'item:cropsnh:materialLeaf@10', maxRate: 5.57 }],
  externals: ['item:x@0'],
};

test('round-trips a chain', () => {
  const s = memory();
  expect(saveChain(s, chain)).toBe(true);
  expect(loadChain(s)).toEqual({ chain });
});

test('nothing stored gives an empty chain without an error', () => {
  expect(loadChain(memory())).toEqual({ chain: emptyChain() });
});

test('garbage gives an empty chain and an error', () => {
  const s = memory();
  s.setItem(CHAIN_KEY, '{nope');
  const r = loadChain(s);
  expect(r.chain).toEqual(emptyChain());
  expect(r.error).toMatch(/calculator chain/i);
});

test('saving without storage, or when it throws, returns false', () => {
  expect(saveChain(undefined, chain)).toBe(false);
  const s = memory();
  s.setItem = () => { throw new Error('full'); };
  expect(saveChain(s, chain)).toBe(false);
});
