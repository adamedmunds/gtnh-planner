import { emptyChain, type Chain } from '../calc/chain';
import { K } from '../test/oilBerryDb';
import { filterRows, pickerRows, pickerTitle } from './picker';
import { db, rn } from './testChains';

const withExtractor: Chain = { ...emptyChain(), nodes: [rn('fe', 0, 511)] };

test('makes: the distillery for sulfuric light fuel, with the reason it fits', () => {
  const rows = pickerRows({ kind: 'makes', key: K.sulfuricLightFuel }, withExtractor, db, 10);
  expect(rows[0].recipe?.id).toBe(1);
  expect(rows[0].reason).toBe('uses Oil you already make');
  expect(rows[0]).toMatchObject({ tier: 'LV', seconds: 1.5, eut: 24 });
  expect(rows[0].machine.mID).toBe(531);
});

test('kept lists what is not used up', () => {
  const [row] = pickerRows({ kind: 'makes', key: K.sulfuricLightFuel }, emptyChain(), db, 10);
  expect(row.kept.map((s) => s.key)).toEqual([K.circuit2]);
  expect(row.consumed.map((s) => s.key)).toEqual([K.oil]);
  expect(row.reason).toBeUndefined();
});

test('uses: oil berries go to the fluid extractor first', () => {
  const rows = pickerRows({ kind: 'uses', key: K.oilBerry }, emptyChain(), db, 10);
  expect(rows[0].recipe?.id).toBe(0);
});

test('uses names other inputs the line already makes', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('cr', 3, 421)] };
  const [row] = pickerRows({ kind: 'uses', key: K.h2sCell }, chain, db, 10);
  expect(row.recipe?.id).toBe(4);
  expect(row.reason).toBe('uses Empty Cell you already make');
});

test('power: fuels the line makes come first, each with its lowest generator', () => {
  const chain: Chain = { ...emptyChain(), nodes: [rn('cr', 3, 421)] };
  const [row] = pickerRows({ kind: 'power' }, chain, db, 10);
  expect(row.fuel?.key).toBe(K.lightFuel);
  expect(row.machine.mID).toBe(1110);
  expect(row.reason).toBe('burns Light Fuel the line makes');
});

test('filter by text matches item, machine or map names', () => {
  const rows = pickerRows({ kind: 'uses', key: K.oil }, emptyChain(), db, 10);
  expect(rows).toHaveLength(2);
  expect(filterRows(rows, 'heavy', db).map((r) => r.recipe?.id)).toEqual([2]);
  expect(filterRows(rows, 'DISTILL', db)).toHaveLength(2);
  expect(filterRows(rows, '', db)).toHaveLength(2);
});

test('titles', () => {
  expect(pickerTitle({ kind: 'makes', key: K.sulfuricLightFuel }, db)).toBe('What makes Sulfuric Light Fuel?');
  expect(pickerTitle({ kind: 'uses', key: K.oilBerry }, db)).toBe('What uses Oil Berry?');
  expect(pickerTitle({ kind: 'power' }, db)).toBe('Power it with a generator');
});
