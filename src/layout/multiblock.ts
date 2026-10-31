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
  /** An output hatch pasted locked to its one fluid, so no other fluid of the recipe goes into it. */
  locked?: boolean;
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
const HEAT_PROOF = 'casing_heat_proof';
const FROST_PROOF = 'casing_frost_proof';
const SOLID_STEEL = 'casing_solid_steel';

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

/**
 * Distillation Tower: 3x3, one layer per fluid output above the bottom layer (at least 3 tall). GT needs 7h - 5 casings
 * for a tower h tall (MTEDistillationTower.checkMachine: checkCasingMin(..., 7 * (mHeight + 1) - 5)); with every
 * bottom-layer port used this structure has exactly that many.
 */
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

/**
 * The 14 hatch spots of a 3x3x3 box with its controller at [1,1,2] and the maintenance hatch at [1,0,0]: the front
 * face first (the 8 around the controller), then the side faces; the back keeps the maintenance hatch and a coil.
 */
const HATCH_SPOTS: { rel: Vec3; facing: Facing }[] = [
  ...[[0, 1, 2], [2, 1, 2], [0, 0, 2], [2, 0, 2], [1, 0, 2], [0, 2, 2], [2, 2, 2], [1, 2, 2]].map((r) => ({ rel: r as unknown as Vec3, facing: 3 as Facing })),
  ...[[1, 1], [0, 1], [2, 1]].flatMap(([y, z]) => [{ rel: [0, y, z] as Vec3, facing: 4 as Facing }, { rel: [2, y, z] as Vec3, facing: 5 as Facing }]),
];

/**
 * The energy hatch first (so running out of spots never leaves the machine without power), then the input hatches, then
 * the output hatches, on the first `limit` of HATCH_SPOTS; the rest get a note naming the machine.
 */
function placeHatches(b: Builder, pm: PlanMachine, tier: string, limit: number, noun: string): void {
  const wanted: { kind: PortKind; key: string; keys: ResourceKey[] }[] = [
    { kind: 'energy', key: tier, keys: [] },
    ...hatchesFor(pm.inputs, 'in').map((p) => ({ kind: 'in' as const, ...p })),
    ...hatchesFor(pm.outputs, 'out').map((p) => ({ kind: 'out' as const, ...p })),
  ];
  wanted.forEach((w, i) => {
    const spot = i < limit ? HATCH_SPOTS[i] : undefined;
    if (spot) b.port(spot.rel, spot.facing, w.kind, w.key, w.keys);
    else b.notes.push(`No room on the ${noun} for another ${w.kind} hatch.`);
  });
}

/**
 * Large Chemical Reactor: 3x3x3 Chemically Inert, PTFE pipe in the middle, one coil at the middle layer's back centre.
 * GT needs 8 casings (MTELargeChemicalReactor.checkMachine: checkCasingMin(..., 8)); 14 hatch spots leave 9.
 */
function largeChemicalReactor(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([3, 3, 3], tier);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) b.block([x, y, z], INERT);
  b.block([1, 1, 1], PTFE);
  b.block([1, 1, 0], COIL);
  b.block([1, 1, 2], pm.key);
  b.port([1, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  placeHatches(b, pm, tier, HATCH_SPOTS.length, 'reactor');
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
  // One hatch per fluid (at least one: GT needs an input on one side and an output on the other). Every hatch takes a
  // casing's place, and the cracker needs 18 casings (MTEOilCracker.checkMachine: checkCasingMin(..., 18)).
  const column = (x: number, kind: 'in' | 'out', keys: ResourceKey[], ys: number[]) => {
    const key = kind === 'in' ? 'hatch_input_lv' : 'hatch_output_lv';
    ys.slice(0, Math.max(1, keys.length)).forEach((y, i) => b.port([x, y, 2], 3, kind, key, keys[i] ? [keys[i]] : []));
    if (keys.length > ys.length) b.notes.push(`The cracker's ${x === 0 ? 'input' : 'output'} column has room for ${ys.length} fluids.`);
  };
  column(0, 'in', oil, [1, 0, 2]);
  column(4, 'out', pm.outputs.filter(isFluid), [1, 0, 2]);
  column(2, 'in', crack ? [crack] : [], [0]);
  return b.done();
}

/** Heating Coils the planner builds with, coolest first (GT's HeatingCoilLevel.getHeat: 1801, 2701, 3601 K). */
export const COILS: readonly { key: string; name: string; heat: number }[] = [
  { key: 'coil_cupronickel', name: 'Cupronickel', heat: 1801 },
  { key: 'coil_kanthal', name: 'Kanthal', heat: 2701 },
  { key: 'coil_nichrome', name: 'Nichrome', heat: 3601 },
];

export const EBF_ID = 1000;
const IMPLOSION_COMPRESSOR_ID = 1001;
const VACUUM_FREEZER_ID = 1002;
export const PYROLYSE_OVEN_ID = 15546;

/** Controllers whose structure has a muffler hatch (on top of the EBF, the Implosion Compressor and the Pyrolyse Oven). */
export function hasMuffler(mID: number): boolean {
  return mID === EBF_ID || mID === IMPLOSION_COMPRESSOR_ID || mID === PYROLYSE_OVEN_ID;
}

/** Energy hatches go up to HV; ULV takes an LV one. Above that, no structure. */
function energyHatch(tier: string | undefined): string | undefined {
  const t = (tier ?? 'LV').toUpperCase();
  if (t === 'ULV' || t === 'LV') return 'hatch_energy_lv';
  if (t === 'MV' || t === 'HV') return `hatch_energy_${t.toLowerCase()}`;
  return undefined;
}

/**
 * The heat an Electric Blast Furnace reaches: coil heat + 100 K per energy hatch tier above MV
 * (MTEElectricBlastFurnace.checkMachine: coil heat + 100 * (GTUtility.getTier(getMaxInputVoltage()) - 2)), with the
 * hatch the layout uses (LV 1, MV 2, HV 3; ULV gets an LV hatch). Above HV there is no hatch; counted as HV.
 */
export function ebfHeat(coilHeat: number, tier: string | undefined): number {
  const hatch = energyHatch(tier);
  const n = hatch === 'hatch_energy_lv' ? 1 : hatch === 'hatch_energy_mv' ? 2 : 3;
  return coilHeat + 100 * (n - 2);
}

/** The first coil whose furnace heat with this tier's energy hatch reaches `heat`; undefined if even Nichrome falls short. */
export function coilFor(heat: number, tier: string | undefined): (typeof COILS)[number] | undefined {
  return COILS.find((c) => ebfHeat(c.heat, tier) >= heat);
}

/**
 * Electric Blast Furnace: 3x3x4. Bottom layer Heat Proof casings with the controller at the front centre and the
 * hatches; two coil rings (16 coils, all one kind, air in the centre); the top layer Heat Proof casings round the
 * muffler hatch, which faces up and needs air above it (MTEHatchMuffler.polluteEnvironment). Shape and heat:
 * MTEElectricBlastFurnace. There is no casing minimum.
 */
function electricBlastFurnace(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([3, 4, 3], tier);
  const coil = coilFor(pm.heat ?? 0, pm.tier)!;
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      b.block([x, 0, z], HEAT_PROOF);
      b.block([x, 3, z], HEAT_PROOF);
      if (x !== 1 || z !== 1) for (const y of [1, 2]) b.block([x, y, z], coil.key);
    }
  }
  b.block([1, 0, 2], pm.key);
  b.port([1, 3, 1], 1, 'muffler', 'hatch_muffler_lv');
  b.energy([2, 0, 2], 3);
  b.port([1, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  const ins = hatchesFor(pm.inputs, 'in');
  const outs = hatchesFor(pm.outputs, 'out');
  const itemIn = ins.find((p) => isItem(p.keys[0]));
  const itemOut = outs.find((p) => isItem(p.keys[0]));
  if (itemIn) b.port([0, 0, 1], 4, 'in', itemIn.key, itemIn.keys);
  if (itemOut) b.port([2, 0, 1], 5, 'out', itemOut.key, itemOut.keys);
  // Fluid hatches, inputs before outputs: front left, back left, back right.
  const slots: { rel: Vec3; facing: Facing }[] = [{ rel: [0, 0, 2], facing: 3 }, { rel: [0, 0, 0], facing: 4 }, { rel: [2, 0, 0], facing: 5 }];
  const fluids = [
    ...ins.filter((p) => isFluid(p.keys[0])).map((p) => ({ kind: 'in' as const, ...p })),
    ...outs.filter((p) => isFluid(p.keys[0])).map((p) => ({ kind: 'out' as const, ...p })),
  ];
  fluids.slice(0, slots.length).forEach((f, i) => b.port(slots[i].rel, slots[i].facing, f.kind, f.key, f.keys));
  if (fluids.length > slots.length) b.notes.push(`${fluids.length - slots.length} fluid hatches don't fit on the furnace's bottom layer.`);
  return b.done();
}

/**
 * Vacuum Freezer: 3x3x3 Frost Proof casings round an air centre, controller at the middle front. GT needs 16 casings
 * (MTEVacuumFreezer.checkMachine: checkCasingMin(errors, mCasing, 16)); the maintenance hatch and at most 8 more hatches
 * leave exactly 16.
 */
function vacuumFreezer(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([3, 3, 3], tier);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) if (x !== 1 || y !== 1 || z !== 1) b.block([x, y, z], FROST_PROOF);
  b.block([1, 1, 2], pm.key);
  b.port([1, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  placeHatches(b, pm, tier, 8, 'vacuum freezer');
  return b.done();
}

/**
 * Implosion Compressor: 3x3x3 Solid Steel casings round an air centre, controller at the middle front, the muffler in
 * the middle of the top facing up. GT needs 16 casings (MTEImplosionCompressor.checkMachine: checkCasingMin(errors,
 * mCasing, 16)); the maintenance hatch, the muffler and at most 7 more hatches leave exactly 16.
 */
function implosionCompressor(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([3, 3, 3], tier);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) if (x !== 1 || y !== 1 || z !== 1) b.block([x, y, z], SOLID_STEEL);
  b.block([1, 1, 2], pm.key);
  b.port([1, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  b.port([1, 2, 1], 1, 'muffler', 'hatch_muffler_lv');
  placeHatches(b, pm, tier, 7, 'implosion compressor');
  return b.done();
}

/** MTEPyrolyseOven's shape: [c][b], c 0 the front layer, b 0 the top row; the character's index is x. */
const PYROLYSE_SHAPE = [
  ['       ', '       ', ' F   F ', 'FBF FBF', 'DBD~DBD', 'GGGGGGG'],
  ['       ', '       ', ' C   C ', 'F FFF F', 'D D D D', 'GCGGGCG'],
  ['       ', '       ', ' C   C ', 'F FFF F', 'D     D', 'GCGGGCG'],
  ['       ', '       ', ' C   C ', 'F FFF F', 'D D D D', 'GCGGGCG'],
  [' E   E ', ' A   A ', ' A   A ', 'FAF FAF', 'DADDDAD', 'GGGGGGG'],
];
const PYROLYSE_BLOCKS: Record<string, string> = { C: 'coil_kanthal', A: 'casing_steel_pipe', B: 'casing_steel_firebox', E: 'frame_steel', D: 'casing_pyrolyse', F: 'casing_pyrolyse', G: 'casing_pyrolyse' };

/**
 * Pyrolyse Oven: 7x6x5, shape and 60-casing minimum from MTEPyrolyseOven (checkCasingMin(errors, mCasing, 60); 73 casing
 * or hatch cells, so at most 13 hatches). The coil is Kanthal: GT's speed multiplier is 2 / (1 + coil tier) and Kanthal
 * is tier 1, so the oven runs at the recipe's own speed. The steel frames (corner posts) are drawn in 3D but can't go in
 * a schematic. Inputs and the muffler (up, with air above) take the F cells, outputs, energy and maintenance the G cells.
 */
function pyrolyseOven(pm: PlanMachine, tier: string): Structure {
  const b = new Builder([7, 6, 5], tier);
  PYROLYSE_SHAPE.forEach((rows, c) => rows.forEach((row, r) => [...row].forEach((ch, x) => {
    if (ch === ' ') return;
    b.block([x, 5 - r, 4 - c], ch === '~' ? pm.key : PYROLYSE_BLOCKS[ch]);
  })));
  b.energy([5, 0, 4], 3);
  b.port([3, 0, 0], 2, 'maintenance', 'hatch_maintenance');
  b.port([3, 2, 2], 1, 'muffler', 'hatch_muffler_lv');
  const ins = hatchesFor(pm.inputs, 'in');
  const outs = hatchesFor(pm.outputs, 'out');
  const itemIn = ins.find((p) => isItem(p.keys[0]));
  const itemOut = outs.find((p) => isItem(p.keys[0]));
  if (itemIn) b.port([0, 2, 2], 4, 'in', itemIn.key, itemIn.keys);
  if (itemOut) b.port([6, 0, 2], 5, 'out', itemOut.key, itemOut.keys);
  const side = (list: typeof ins, kind: 'in' | 'out', spots: Vec3[], facing: Facing, word: string, noun: string) => {
    const fluids = list.filter((p) => isFluid(p.keys[0]));
    fluids.slice(0, spots.length).forEach((p, i) => b.port(spots[i], facing, kind, p.key, p.keys));
    if (fluids.length > spots.length) b.notes.push(`${fluids.length - spots.length} fluid ${word} don't fit on the oven's ${noun} side.`);
  };
  side(ins, 'in', [[0, 2, 3], [0, 2, 1]], 4, 'inputs', 'left');
  side(outs, 'out', [[6, 0, 3], [6, 0, 1]], 5, 'outputs', 'right');
  return b.done();
}

type Definition = (pm: PlanMachine, energyKey: string) => Structure;

/** Multiblocks with a definition, by controller mID; the next one is one more function here. */
const DEFINITIONS: Partial<Record<number, Definition>> = {
  1126: distillationTower,
  1169: largeChemicalReactor,
  1160: oilCrackingUnit,
  [EBF_ID]: electricBlastFurnace,
  [IMPLOSION_COMPRESSOR_ID]: implosionCompressor,
  [VACUUM_FREEZER_ID]: vacuumFreezer,
  [PYROLYSE_OVEN_ID]: pyrolyseOven,
};

/** Whether Build in 3D has a block-for-block layout for this controller (at some tier). */
export function hasLayout(mID: number): boolean {
  return DEFINITIONS[mID] !== undefined;
}

/** Whether the machine gets a structure: a definition, an energy hatch for the tier, and (EBF) a coil that reaches `heat`. */
export function buildable(mID: number, tier: string | undefined, heat = 0): boolean {
  if (!DEFINITIONS[mID] || !energyHatch(tier)) return false;
  return mID !== EBF_ID || coilFor(heat, tier) !== undefined;
}

/** Undefined for multiblocks without a definition (or above HV, or an EBF too hot for Nichrome): they keep the one-block stand-in. */
export function structureFor(pm: PlanMachine): Structure | undefined {
  if (!buildable(pm.machine.mID, pm.tier, pm.heat)) return undefined;
  const define = DEFINITIONS[pm.machine.mID]!;
  const s = define(pm, energyHatch(pm.tier)!);
  if (define !== distillationTower) lockOutputs(s);
  return s;
}

/**
 * GT puts each fluid output into any output hatch that can hold it (MTEHatchOutput.canStoreFluid: an unlocked, empty
 * hatch takes any fluid), so with two or more output hatches one fluid can end up in another's hatch and pipe. Each is
 * locked to its fluid instead. The Distillation Tower is the exception: it fills each layer's hatches with that layer's
 * fluid only.
 */
function lockOutputs(s: Structure): void {
  const outs = s.ports.filter((p) => p.kind === 'out' && p.key === 'hatch_output_lv');
  if (outs.length < 2) return;
  for (const p of outs) if (p.keys.length === 1 && isFluid(p.keys[0])) p.locked = true;
}
