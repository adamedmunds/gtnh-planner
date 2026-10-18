import { RecipeDb } from '../recipes/db';
import { oilBerryData } from '../test/oilBerryDb';
import { defaultMachine, generatorOptions, machineOptions } from './machines';

const db = new RecipeDb(oilBerryData());

test('defaultMachine picks the lowest tier that can run the recipe', () => {
  expect(defaultMachine(db.recipe(4)!, db)?.mID).toBe(372);
  expect(defaultMachine(db.recipe(1)!, db)?.mID).toBe(531);
});

test('machineOptions lists every machine that can run the recipe, lowest first', () => {
  expect(machineOptions(db.recipe(4)!, db).map((m) => m.mID)).toEqual([372]);
  expect(machineOptions(db.recipe(1)!, db).map((m) => m.mID)).toEqual([531, 532]);
});

test('generatorOptions lists the generators on a fuel map by tier', () => {
  expect(generatorOptions(4, db).map((m) => m.mID)).toEqual([1110, 1111]);
});
