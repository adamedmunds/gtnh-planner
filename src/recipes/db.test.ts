import { RecipeDb, recipeSignature } from './db';
import { K, oilBerryData } from '../test/oilBerryDb';

const db = new RecipeDb(oilBerryData());

test('producersOf / consumersOf', () => {
  expect(db.producersOf(K.oil).map((r) => r.id)).toEqual([0]);
  expect(db.consumersOf(K.oil).map((r) => r.id).sort()).toEqual([1, 2]);
  expect(db.producersOf(K.hydrogenCell).map((r) => r.id)).toEqual([4]);
  expect(db.producersOf('item:nothing@0')).toEqual([]);
});

test('non-consumed inputs (circuits) do not count as uses', () => {
  expect(db.consumersOf(K.circuit2)).toEqual([]);
});

test('search is case-insensitive and ranks exact and prefix matches first', () => {
  const names = db.search('light fuel').map((r) => r.name);
  expect(names[0]).toBe('Light Fuel');
  expect(names).toContain('Sulfuric Light Fuel');
  expect(db.search('OIL')[0].name).toBe('Oil');
  expect(db.search('oil', 1)).toHaveLength(1);
});

test('signatures identify recipes by content, using the map id', () => {
  const r = db.recipe(1)!;
  const sig = recipeSignature(r, db);
  expect(sig.startsWith('gt.recipe.distillery|')).toBe(true);
  expect(db.bySignature(sig)).toBe(r);
  expect(db.bySignature('gt.recipe.distillery|nope|nope')).toBeUndefined();
});

test('fuelsFor and mapIndexById', () => {
  expect(db.mapIndexById('gt.recipe.dieselgeneratorfuel')).toBe(4);
  expect(db.fuelsFor(4)).toEqual([{ map: 4, key: K.lightFuel, euPerLitre: 305 }]);
  expect(db.mapIndexById('gt.recipe.nope')).toBeUndefined();
  expect(db.gregtech).toBe('5.09.54.183');
  expect(db.dumpFormat).toBe(2);
});
