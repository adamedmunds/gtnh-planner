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

test('machineOptions puts a multiblock Build in 3D can lay out before ones it cannot', () => {
  const data = oilBerryData();
  data.resources.push({ key: 'item:dust_in', name: 'Dust', kind: 'item' }, { key: 'item:gem_out', name: 'Gem', kind: 'item' });
  const machines = [{ mID: 964, name: 'Density^2', multiblock: true }, { mID: 1001, name: 'Implosion Compressor', multiblock: true }, { mID: 15547, name: 'Density^2', multiblock: true }];
  data.maps.push({ index: 5, id: 'gt.recipe.implosioncompressor', name: 'Implosion Compressor', amperage: 1, machines });
  data.recipes.push({ id: 5, map: 5, eut: 30, duration: 20, specialValue: 0,
    inputs: [{ key: 'item:dust_in', amount: 4, consumed: true }], outputs: [{ key: 'item:gem_out', amount: 3, chance: 1 }] });
  const implosionDb = new RecipeDb(data);
  expect(machineOptions(implosionDb.recipe(5)!, implosionDb).map((m) => m.mID)).toEqual([1001, 964, 15547]);
  expect(defaultMachine(implosionDb.recipe(5)!, implosionDb)?.mID).toBe(1001);
});

test('generatorOptions lists the generators on a fuel map by tier', () => {
  expect(generatorOptions(4, db).map((m) => m.mID)).toEqual([1110, 1111]);
});
