import type { AppRecipeData, MachineRef, Recipe } from '../recipes/types';

/** Resource keys exactly as they appear in the user's GTNH 2.9 dump. */
export const K = {
  oilBerry: 'item:cropsnh:materialLeaf@10',
  circuit2: 'item:gregtech:gt.integrated_circuit@2',
  circuit4: 'item:gregtech:gt.integrated_circuit@4',
  oil: 'fluid:oil',
  sulfuricLightFuel: 'fluid:liquid_sufluriclight_fuel',
  sulfuricHeavyFuel: 'fluid:liquid_sulfuricheavy_fuel',
  lightFuel: 'fluid:liquid_light_fuel',
  hydrogenCell: 'item:gregtech:gt.metaitem.01@30001',
  h2sCell: 'item:gregtech:gt.metaitem.01@30460',
  emptyCell: 'item:IC2:itemCellEmpty@0',
  sulfur: 'item:gregtech:gt.metaitem.01@2022',
  eu: 'eu',
} as const;

const machine = (mID: number, name: string, tier: number, extra: Partial<MachineRef> = {}): MachineRef => ({
  mID, name, tier, multiblock: false, voltage: [8, 32, 128, 512][tier], ...extra,
});

/** The verified oil berry → light fuel recipes (from the dump), plus one decoy distillery recipe. */
export function oilBerryData(): AppRecipeData {
  const recipes: Recipe[] = [
    { id: 0, map: 0, eut: 30, duration: 20, specialValue: 0,
      inputs: [{ key: K.oilBerry, amount: 1, consumed: true }],
      outputs: [{ key: K.oil, amount: 100, chance: 1 }] },
    { id: 1, map: 1, eut: 24, duration: 30, specialValue: 0,
      inputs: [{ key: K.circuit2, amount: 0, consumed: false }, { key: K.oil, amount: 50, consumed: true }],
      outputs: [{ key: K.sulfuricLightFuel, amount: 50, chance: 1 }] },
    { id: 2, map: 1, eut: 24, duration: 60, specialValue: 0,
      inputs: [{ key: 'item:gregtech:gt.integrated_circuit@1', amount: 0, consumed: false }, { key: K.oil, amount: 100, consumed: true }],
      outputs: [{ key: K.sulfuricHeavyFuel, amount: 30, chance: 1 }] },
    { id: 3, map: 2, eut: 30, duration: 160, specialValue: 0,
      inputs: [
        { key: K.hydrogenCell, amount: 2, consumed: true },
        { key: K.circuit4, amount: 0, consumed: false },
        { key: K.sulfuricLightFuel, amount: 12000, consumed: true },
      ],
      outputs: [
        { key: K.h2sCell, amount: 1, chance: 1 },
        { key: K.emptyCell, amount: 1, chance: 1 },
        { key: K.lightFuel, amount: 12000, chance: 1 },
      ] },
    { id: 4, map: 3, eut: 120, duration: 72, specialValue: 0,
      inputs: [{ key: K.h2sCell, amount: 1, consumed: true }, { key: K.emptyCell, amount: 1, consumed: true }],
      outputs: [{ key: K.sulfur, amount: 1, chance: 1 }, { key: K.hydrogenCell, amount: 2, chance: 1 }] },
  ];
  const names: [string, string, 'item' | 'fluid' | 'eu'][] = [
    [K.oilBerry, 'Oil Berry', 'item'], [K.circuit2, 'Programmed Circuit', 'item'], [K.circuit4, 'Programmed Circuit', 'item'],
    ['item:gregtech:gt.integrated_circuit@1', 'Programmed Circuit', 'item'],
    [K.oil, 'Oil', 'fluid'], [K.sulfuricLightFuel, 'Sulfuric Light Fuel', 'fluid'], [K.sulfuricHeavyFuel, 'Sulfuric Heavy Fuel', 'fluid'],
    [K.lightFuel, 'Light Fuel', 'fluid'], [K.hydrogenCell, 'Hydrogen Cell', 'item'], [K.h2sCell, 'Hydrogen Sulfide Cell', 'item'],
    [K.emptyCell, 'Empty Cell', 'item'], [K.sulfur, 'Sulfur Dust', 'item'], [K.eu, 'EU', 'eu'],
  ];
  return {
    format: 1,
    gregtech: '5.09.54.183',
    dumpFormat: 2,
    exportedAt: 0,
    resources: names.map(([key, name, kind]) => ({ key, name, kind })),
    maps: [
      { index: 0, id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor', amperage: 1,
        machines: [machine(511, 'Basic Fluid Extractor', 1), machine(512, 'Advanced Fluid Extractor', 2)] },
      { index: 1, id: 'gt.recipe.distillery', name: 'Distillery', amperage: 1,
        machines: [machine(531, 'Basic Distillery', 1), machine(532, 'Advanced Distillery', 2)] },
      { index: 2, id: 'gt.recipe.chemicalreactor', name: 'Chemical Reactor', amperage: 1,
        machines: [machine(421, 'Basic Chemical Reactor', 1), machine(422, 'Advanced Chemical Reactor', 2)] },
      { index: 3, id: 'gt.recipe.electrolyzer', name: 'Electrolyzer', amperage: 1,
        machines: [machine(371, 'Basic Electrolyzer', 1), machine(372, 'Advanced Electrolyzer', 2)] },
      { index: 4, id: 'gt.recipe.dieselgeneratorfuel', name: 'Combustion Generator Fuels', amperage: 1,
        machines: [
          machine(1110, 'Basic Combustion Generator', 1, { generator: { efficiency: 95, euOut: 32, ampsOut: 1 } }),
          machine(1111, 'Advanced Combustion Generator', 2, { generator: { efficiency: 90, euOut: 128, ampsOut: 1 } }),
        ] },
    ],
    recipes,
    fuels: [{ map: 4, key: K.lightFuel, euPerLitre: 305 }],
  };
}
