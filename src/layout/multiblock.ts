import type { Facing, PortKind, Vec3 } from '../model/types';
import type { ResourceKey } from '../recipes/types';
import type { PlanMachine } from './types';

/** A hatch or bus in a multiblock's wall: `rel` is its cell, `facing` the side its pipe or cable is on. */
export interface Port {
  rel: Vec3;
  facing: Facing;
  kind: PortKind;
  /** Hatch catalog key. */
  key: string;
  /** What passes through it; empty for a hatch the structure needs but no recipe resource uses. */
  keys: ResourceKey[];
}

/**
 * A multiblock's blocks. `rel` is [x, y, z] from 0: y 0 is the bottom, and z = depth - 1 is the front row, facing +z
 * (side 3). A port's cell is not also in `blocks`; air cells are in neither.
 */
export interface Structure {
  size: Vec3;
  blocks: { rel: Vec3; key: string }[];
  ports: Port[];
  notes: string[];
}

/** Fluids the Oil Cracking Unit takes in on its middle column, as the recipe dump spells them. */
export const CRACKING_FLUIDS: readonly ResourceKey[] = ['fluid:hydrogen', 'fluid:steam'];

const CASING = 'casing_clean_stainless';
const INERT = 'casing_chemically_inert';
const PTFE = 'casing_ptfe_pipe';
const COIL = 'coil_cupronickel';

const isFluid = (k: ResourceKey) => k.startsWith('fluid:');
const isItem = (k: ResourceKey) => k.startsWith('item:');

/** Accumulates one structure: a cell is a block or a port, never both. */
class Builder {
  readonly blocks = new Map<string, { rel: Vec3; key: string }>();
  readonly ports: Port[] = [];
  readonly notes: string[] = [];
  constructor(
    readonly size: Vec3,
    private tier: string,
  ) {}

  block(rel: Vec3, key: string): void {
    this.blocks.set(rel.join(','), { rel, key });
  }

  port(rel: Vec3, facing: Facing, kind: PortKind, key: string, keys: ResourceKey[] = []): void {
    this.blocks.delete(rel.join(','));
    this.ports.push({ rel, facing, kind, key, keys });
  }

  energy(rel: Vec3, facing: Facing): void {
    this.port(rel, facing, 'energy', this.tier);
  }

  done(): Structure {
    return { size: this.size, blocks: [...this.blocks.values()], ports: this.ports, notes: this.notes };
  }
}

/** The hatch for a direction: `hatch_*` per fluid, one bus for all the items. Empty directions give no entries. */
function hatchesFor(keys: ResourceKey[], kind: 'in' | 'out'): { key: string; keys: ResourceKey[] }[] {
  const hatch = kind === 'in' ? 'hatch_input_lv' : 'hatch_output_lv';
  const bus = kind === 'in' ? 'bus_input_lv' : 'bus_output_lv';
  const list = keys.filter(isFluid).map((k) => ({ key: hatch, keys: [k] }));
  const items = keys.filter(isItem);
  if (items.length) list.push({ key: bus, keys: items });
  return list;
}

/** Distillation Tower: 3x3, one layer per fluid output above the bottom layer (at least 3 tall). */
function distillationTower(pm: PlanMachine, tier: string): Structure {
  const fluids = pm.fluidOutputs ?? pm.outputs.filter(isFluid);
  const h = Math.max(3, fluids.length + 1);
  const b = new Builder([3, h, 3], tier);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        const air = y > 0 && y < h - 1 && x === 1 && z === 1;
        if (!air) b.block([x, y, z], CASING);
      }
    }
  }
  b.block([1, 0, 2], pm.key);
  b.energy([2, 0, 2], 3);
  b.port([1, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  // Layer n holds fluid n's output hatch; a layer past the last fluid still needs one, and gets an empty hatch.
  for (let n = 1; n < h; n++) b.port([1, n, 2], 3, 'out', 'hatch_output_lv', fluids[n - 1] ? [fluids[n - 1]] : []);
  // Bottom layer: fluid input hatches on the front-left, then the back corners; item buses at the side centres.
  const slots: Vec3[] = [[0, 0, 2], [0, 0, 0], [2, 0, 0]];
  const ins = hatchesFor(pm.inputs, 'in');
  const fluidIns = ins.filter((p) => p.keys.length === 1 && isFluid(p.keys[0]));
  const itemIn = ins.find((p) => isItem(p.keys[0]));
  if (!fluidIns.length) fluidIns.push({ key: 'hatch_input_lv', keys: [] });
  fluidIns.slice(0, slots.length).forEach((p, i) => b.port(slots[i], i === 0 ? 3 : i === 1 ? 4 : 5, 'in', p.key, p.keys));
  if (fluidIns.length > slots.length) b.notes.push(`${fluidIns.length - slots.length} fluid inputs don't fit on the tower's bottom layer.`);
  if (itemIn) b.port([0, 0, 1], 4, 'in', itemIn.key, itemIn.keys);
  const itemOut = hatchesFor(pm.outputs, 'out').find((p) => isItem(p.keys[0]));
  if (itemOut) b.port([2, 0, 1], 5, 'out', itemOut.key, itemOut.keys);
  return b.done();
}

/** Large Chemical Reactor: 3x3x3 Chemically Inert, PTFE pipe in the middle, one coil at the middle layer's back centre. */
function largeChemicalReactor(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([3, 3, 3], tier);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) b.block([x, y, z], INERT);
  b.block([1, 1, 1], PTFE);
  b.block([1, 1, 0], COIL);
  b.block([1, 1, 2], pm.key);
  b.port([1, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  // Front face first, then the side faces; the back (z = 0) keeps the coil and the maintenance hatch.
  const spots: { rel: Vec3; facing: Facing }[] = [
    [0, 1, 2], [2, 1, 2], [0, 0, 2], [2, 0, 2], [1, 0, 2], [0, 2, 2], [2, 2, 2], [1, 2, 2],
  ].map((r) => ({ rel: r as unknown as Vec3, facing: 3 as Facing }));
  for (const [y, z] of [[1, 1], [0, 1], [2, 1]]) {
    spots.push({ rel: [0, y, z], facing: 4 }, { rel: [2, y, z], facing: 5 });
  }
  const wanted: { kind: PortKind; key: string; keys: ResourceKey[] }[] = [
    ...hatchesFor(pm.inputs, 'in').map((p) => ({ kind: 'in' as const, ...p })),
    ...hatchesFor(pm.outputs, 'out').map((p) => ({ kind: 'out' as const, ...p })),
    { kind: 'energy', key: tier, keys: [] },
  ];
  wanted.forEach((w, i) => {
    const spot = spots[i];
    if (spot) b.port(spot.rel, spot.facing, w.kind, w.key, w.keys);
    else b.notes.push(`No room on the reactor for another ${w.kind} hatch.`);
  });
  return b.done();
}

/** Oil Cracking Unit: 5x3x3, columns l c m c r; coils in the c columns, the middle row of the middle layer empty. */
function oilCrackingUnit(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([5, 3, 3], tier);
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) {
        if (y === 1 && z === 1 && x >= 1 && x <= 3) continue;
        b.block([x, y, z], x === 1 || x === 3 ? COIL : CASING);
      }
    }
  }
  b.block([2, 1, 2], pm.key);
  b.port([2, 1, 0], 2, 'maintenance', 'hatch_maintenance');
  b.energy([2, 2, 2], 3);
  const fluidIns = pm.inputs.filter(isFluid);
  const crack = fluidIns.find((k) => CRACKING_FLUIDS.includes(k));
  const oil = fluidIns.filter((k) => k !== crack);
  const column = (x: number, kind: 'in' | 'out', keys: ResourceKey[], ys: number[]) => {
    const key = kind === 'in' ? 'hatch_input_lv' : 'hatch_output_lv';
    ys.forEach((y, i) => b.port([x, y, 2], 3, kind, key, keys[i] ? [keys[i]] : []));
    if (keys.length > ys.length) b.notes.push(`The cracker's ${x === 0 ? 'input' : 'output'} column has room for ${ys.length} fluids.`);
  };
  column(0, 'in', oil, [1, 0, 2]);
  column(4, 'out', pm.outputs.filter(isFluid), [1, 0, 2]);
  column(2, 'in', crack ? [crack] : [], [0]);
  return b.done();
}

type Definition = (pm: PlanMachine, energyKey: string) => Structure;

/** Multiblocks with a definition, by controller mID; the next one is one more function here. */
const DEFINITIONS: Partial<Record<number, Definition>> = {
  1126: distillationTower,
  1169: largeChemicalReactor,
  1160: oilCrackingUnit,
};

export const MULTIBLOCK_IDS: readonly number[] = Object.keys(DEFINITIONS).map(Number);

/** Energy hatches go up to HV; ULV takes an LV one. Above that, no structure. */
function energyHatch(tier: string | undefined): string | undefined {
  const t = (tier ?? 'LV').toUpperCase();
  if (t === 'ULV' || t === 'LV') return 'hatch_energy_lv';
  if (t === 'MV' || t === 'HV') return `hatch_energy_${t.toLowerCase()}`;
  return undefined;
}

/** Undefined for multiblocks without a definition (or above HV): they keep the one-block stand-in. */
export function structureFor(pm: PlanMachine): Structure | undefined {
  const define = DEFINITIONS[pm.machine.mID];
  const energy = energyHatch(pm.tier);
  return define && energy ? define(pm, energy) : undefined;
}
