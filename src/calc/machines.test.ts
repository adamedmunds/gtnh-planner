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

test('machineOptions leaves out the legacy Pyrolyse Oven when the new one is on the map', () => {
  const data = oilBerryData();
  data.resources.push({ key: 'item:pyro_in', name: 'Pyro In', kind: 'item' }, { key: 'item:pyro_out', name: 'Pyro Out', kind: 'item' });
  const both = [{ mID: 1159, name: 'Pyrolyse Oven', multiblock: true }, { mID: 15546, name: 'Pyrolyse Oven', multiblock: true }];
  data.maps.push({ index: 5, id: 'gt.recipe.pyro', name: 'Pyrolyse Oven', amperage: 1, machines: both });
  data.maps.push({ index: 6, id: 'gt.recipe.pyro_legacy', name: 'Pyrolyse Oven', amperage: 1, machines: [both[0]] });
  for (const [id, map] of [[5, 5], [6, 6]]) {
    data.recipes.push({ id, map, eut: 96, duration: 100, specialValue: 0,
      inputs: [{ key: 'item:pyro_in', amount: 1, consumed: true }], outputs: [{ key: 'item:pyro_out', amount: 1, chance: 1 }] });
  }
  const pyroDb = new RecipeDb(data);
  expect(machineOptions(pyroDb.recipe(5)!, pyroDb).map((m) => m.mID)).toEqual([15546]);
  expect(defaultMachine(pyroDb.recipe(5)!, pyroDb)?.mID).toBe(15546);
  expect(machineOptions(pyroDb.recipe(6)!, pyroDb).map((m) => m.mID)).toEqual([1159]);
});

test('generatorOptions lists the generators on a fuel map by tier', () => {
  expect(generatorOptions(4, db).map((m) => m.mID)).toEqual([1110, 1111]);
});
