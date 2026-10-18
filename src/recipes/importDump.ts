import { EU, type AppRecipeData, type Fuel, type MachineRef, type Recipe, type RecipeMapInfo, type Resource, type Stack } from './types';

/** The `/gtnhplanner dump` file, format 1 or 2 (see mod/.../RecipeDumper.java). */
interface Dump {
  format: number;
  gregtech?: string;
  exportedAt?: number;
  recipeMaps: { id: string; name: string; amperage: number }[];
  machines: {
    mID: number; name: string; tier?: number; voltage?: number; multiblock?: boolean; maps: number[];
    generator?: { efficiency: number; euOut: number; ampsOut: number };
  }[];
  recipes: { m: number; eut: number; dur: number; sv?: number; ii?: number[][]; fi?: number[][]; io?: number[][]; fo?: number[][] }[];
  containers?: number[][];
  items: { id: string; meta: number; name: string }[];
  fluids: { id: string; name: string }[];
}

function isDump(x: unknown): x is Dump {
  const d = x as Dump;
  return !!d && typeof d === 'object' && Array.isArray(d.recipes) && Array.isArray(d.recipeMaps) &&
    Array.isArray(d.machines) && Array.isArray(d.items) && Array.isArray(d.fluids);
}

const itemKey = (it: { id: string; meta: number }) => `item:${it.id}@${it.meta}`;
const fluidKey = (fl: { id: string }) => `fluid:${fl.id}`;

/** Converts a recipe dump into the app's recipe data. Bad recipes are skipped with a warning. */
export function importDump(raw: unknown): { data: AppRecipeData; warnings: string[] } {
  if (!isDump(raw)) throw new Error('Not a recipe dump (expected recipes, recipeMaps, machines, items and fluids)');
  const d = raw;
  const warnings: string[] = [];
  const dumpFormat: 1 | 2 = d.format >= 2 ? 2 : 1;

  const resources: Resource[] = [
    ...d.items.map((it): Resource => ({ key: itemKey(it), name: it.name, kind: 'item' })),
    ...d.fluids.map((fl): Resource => ({ key: fluidKey(fl), name: fl.name, kind: 'fluid' })),
    { key: EU, name: 'EU', kind: 'eu' },
  ];

  const maps: RecipeMapInfo[] = d.recipeMaps.map((m, index) => ({ index, id: m.id, name: m.name, amperage: m.amperage, machines: [] }));
  for (const mc of d.machines) {
    const ref: MachineRef = { mID: mc.mID, name: mc.name, multiblock: !!mc.multiblock };
    if (mc.tier !== undefined) ref.tier = mc.tier;
    if (mc.voltage !== undefined) ref.voltage = mc.voltage;
    if (dumpFormat === 2 && mc.generator) ref.generator = { ...mc.generator };
    for (const mi of mc.maps) maps[mi]?.machines.push(ref);
  }

  // Generator recipe maps: format 2 knows which machines are generators; format 1 falls back to the map id.
  const isFuelMap = (mi: number) =>
    dumpFormat === 2 ? maps[mi].machines.some((m) => m.generator) : /fuels?$/i.test(maps[mi].id);

  const containerFluid = new Map<number, number>(); // item index → fluid index
  for (const c of d.containers ?? []) containerFluid.set(c[0], c[1]);

  const item = (i: number) => {
    const it = d.items[i];
    if (!it) throw new RangeError(`item index ${i}`);
    return itemKey(it);
  };
  const fluid = (i: number) => {
    const fl = d.fluids[i];
    if (!fl) throw new RangeError(`fluid index ${i}`);
    return fluidKey(fl);
  };

  const recipes: Recipe[] = [];
  const fuels: Fuel[] = [];
  const fuelSeen = new Set<string>();
  d.recipes.forEach((r, n) => {
    try {
      if (!maps[r.m]) throw new RangeError(`map index ${r.m}`);
      if (isFuelMap(r.m)) {
        const sv = r.sv ?? 0;
        if (sv <= 0) return;
        let key: string | undefined;
        if (r.fi?.length) key = fluid(r.fi[0][0]);
        else if (r.ii?.length && containerFluid.has(r.ii[0][0])) key = fluid(containerFluid.get(r.ii[0][0])!);
        if (!key) return; // solid fuel: not used by the calculator
        const id = `${r.m}|${key}`;
        if (!fuelSeen.has(id)) {
          fuelSeen.add(id);
          fuels.push({ map: r.m, key, euPerLitre: sv });
        }
        return;
      }
      if (!(r.dur > 0)) throw new RangeError(`non-positive duration ${r.dur} in ${maps[r.m].id}`);
      const inputs: Stack[] = [
        ...(r.ii ?? []).map(([i, amount]) => ({ key: item(i), amount, consumed: amount > 0 })),
        ...(r.fi ?? []).map(([i, amount]) => ({ key: fluid(i), amount, consumed: true })),
      ];
      const outputs: Stack[] = [
        ...(r.io ?? []).map(([i, amount, chance]) => ({ key: item(i), amount, chance: (chance ?? 10000) / 10000 })),
        ...(r.fo ?? []).map(([i, amount]) => ({ key: fluid(i), amount, chance: 1 })),
      ];
      recipes.push({ id: recipes.length, map: r.m, eut: r.eut, duration: r.dur, specialValue: r.sv ?? 0, inputs, outputs });
    } catch (e) {
      warnings.push(`Recipe #${n}: ${(e as Error).message}`);
    }
  });

  return {
    data: {
      format: 1,
      gregtech: d.gregtech ?? 'unknown',
      dumpFormat,
      exportedAt: d.exportedAt ?? 0,
      resources,
      maps,
      recipes,
      fuels,
    },
    warnings,
  };
}
