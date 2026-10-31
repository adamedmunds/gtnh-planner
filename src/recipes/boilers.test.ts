import { K, oilBerryData } from '../test/oilBerryDb';
import { LARGE_BOILER_MAP, LARGE_STEEL_BOILER, STEEL_BOILER_MAP, withBoilerSteam } from './boilers';
import { RecipeDb } from './db';
import type { AppRecipeData } from './types';

/** The oil berry data plus a fake-fuels map like the dump's: Benzene, Coal and Short Mead (whose recipe has a bucket out). */
function withFakeFuels(): AppRecipeData {
  const data = oilBerryData();
  const map = data.maps.length;
  data.maps.push({ index: map, id: LARGE_BOILER_MAP, name: 'Large Boiler', amperage: 1, machines: [
    { mID: 1021, name: 'Large Steel Boiler', multiblock: true }, { mID: 15529, name: 'Large Bronze Boiler', multiblock: true },
    { mID: 15530, name: 'Large Steel Boiler', multiblock: true },
  ] });
  data.resources.push({ key: 'fluid:benzene', name: 'Benzene', kind: 'fluid' }, { key: 'item:minecraft:coal@0', name: 'Coal', kind: 'item' });
  const id = data.recipes.length;
  data.recipes.push(
    { id, map, eut: 0, duration: 365, specialValue: 350, inputs: [{ key: 'fluid:benzene', amount: 1000, consumed: true }], outputs: [] },
    { id: id + 1, map, eut: 0, duration: 1, specialValue: 1, inputs: [{ key: 'item:minecraft:coal@0', amount: 1, consumed: true }], outputs: [] },
    { id: id + 2, map, eut: 0, duration: 4, specialValue: 4, inputs: [{ key: 'fluid:short.mead', amount: 1000, consumed: true }],
      outputs: [{ key: 'item:minecraft:bucket@0', amount: 1, chance: 1 }] },
  );
  return data;
}

test('a fluid fuel recipe becomes fuel + water -> steam at the Large Steel Boiler rate, on a map of its own', () => {
  const data = withFakeFuels();
  const benzene = data.recipes.length - 3;
  const out = withBoilerSteam(data);
  expect(out.maps[data.maps.length]).toEqual({ index: data.maps.length, id: STEEL_BOILER_MAP, name: 'Large Steel Boiler', amperage: 1, machines: [LARGE_STEEL_BOILER] });
  expect(out.recipes[benzene]).toEqual({
    id: benzene, map: data.maps.length, eut: 0, duration: 365, specialValue: 350,
    inputs: [{ key: 'fluid:benzene', amount: 1000, consumed: true }, { key: 'fluid:water', amount: 15 * 365, consumed: true }],
    outputs: [{ key: 'fluid:steam', amount: 2400 * 365, chance: 1 }],
  });
  // 2,400 L a tick is 48,000 L/s of steam for 300 L/s of water.
  expect((2400 * 365 * 20) / 365).toBe(48_000);
});

test("GT's map keeps solid fuels and odd recipes, without the Steel boiler; other maps are untouched", () => {
  const data = withFakeFuels();
  const out = withBoilerSteam(data);
  expect(out.maps[data.maps.length - 1].machines.map((m) => m.mID)).toEqual([1021, 15529]);
  expect(out.recipes.slice(-2)).toEqual(data.recipes.slice(-2));
  expect(out.recipes.slice(0, 5)).toEqual(oilBerryData().recipes);
  expect(out.maps.slice(0, -2)).toEqual(oilBerryData().maps);
  expect(out.resources.find((r) => r.key === 'fluid:steam')).toEqual({ key: 'fluid:steam', name: 'Steam', kind: 'fluid' });
  expect(out.resources.find((r) => r.key === 'fluid:water')).toEqual({ key: 'fluid:water', name: 'Water', kind: 'fluid' });
});

test('data without the boiler map is returned as is', () => {
  const data = oilBerryData();
  expect(withBoilerSteam(data)).toBe(data);
});

test('the recipe database makes steam with the boiler', () => {
  const db = new RecipeDb(withFakeFuels());
  const steam = db.producersOf('fluid:steam');
  expect(steam).toHaveLength(1);
  expect(steam[0].inputs.map((s) => s.key)).toEqual(['fluid:benzene', 'fluid:water']);
  expect(db.consumersOf('fluid:water')).toHaveLength(1);
  expect(db.producersOf(K.oil)).toHaveLength(1);
});
