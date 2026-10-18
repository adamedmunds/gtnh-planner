/**
 * Oil berry → light fuel line, power option B in "row" modules, sized by `makeOilBerryLine`.
 *
 * Each module is an MV→LV transformer (T) with an MV combustion generator directly under it (T's front faces
 * down onto the generator) and up to 3 LV machines touching it: west, east and on top. Modules sit side by
 * side, so the west/east machines form one continuous row and every pipe network is a straight line:
 *
 *   y=3   . U .  . U .  . U .      U = machine on top of T
 *   y=2   W T E  W T E  W T E      row: machines + transformers      back (z=-1): oil line
 *   y=1   . G .  . G .  . G .      G = MV combustion generator       front (z=+1): berries / sulfuric line
 *   y=0   ═════════════════════    light fuel line under every generator
 *
 * The chemical reactor + electrolyzer module sits at x = 0. Extractor modules grow west and distillery modules
 * grow east, so a bigger line contains a smaller one block-for-block: expand in-game by extending the three
 * lines and adding modules at either end. The light fuel tank connects behind the reactor module.
 */
import type { Build, Facing, PlacedBlock, Vec3 } from '../model/types';
import { DIRS, addVec, posKey } from '../model/directions';

export interface OilBerryLineOptions {
  extractors: number;
  distilleries: number;
}

/** LV fluid extractor: 1 berry/s → 100 L/s oil. LV distillery: 33.3 L/s. */
export function countsForBerryRate(berriesPerSecond: number): OilBerryLineOptions {
  const extractors = Math.ceil(berriesPerSecond - 1e-9);
  return { extractors, distilleries: Math.ceil(berriesPerSecond * 3 - 1e-9) };
}

/** One LV chemical reactor processes 12,000 L per 8 s = 1,500 L/s, i.e. the oil of 15 extractors. */
const MAX_EXTRACTORS_PER_REACTOR = 15;

type Slot = 'W' | 'E' | 'U';
const SLOT_ORDER: readonly Slot[] = ['W', 'E', 'U'];
const SLOT_OFFSET: Record<Slot, Vec3> = { W: [-1, 2, 0], E: [1, 2, 0], U: [0, 3, 0] };

// Output side (mFacing) per machine: extractors push oil back, distilleries push sulfuric light fuel forward,
// the reactor pushes cells up (its light fuel leaves through a pump cover on its bottom face), the
// electrolyzer pushes hydrogen cells west.
const FACING: Record<string, Facing> = {
  fluid_extractor_lv: 2,
  distillery_lv: 3,
  chemical_reactor_lv: 1,
  electrolyzer_lv: 4,
};

const PIPES = {
  oil: 'bronze_pipe_normal',
  sulfuric: 'bronze_pipe_normal',
  berries: 'tin_item_pipe_normal',
  fuel: 'steel_pipe_small',
  cells: 'tin_item_pipe_small',
} as const;
type Net = keyof typeof PIPES;

/** Which machines each network may connect to; pipes ignore every other neighbour. */
const SERVES: Record<Net, readonly string[]> = {
  oil: ['fluid_extractor_lv', 'distillery_lv'],
  sulfuric: ['distillery_lv', 'chemical_reactor_lv'],
  berries: ['fluid_extractor_lv'],
  fuel: ['combustion_generator_mv', 'chemical_reactor_lv'],
  cells: ['chemical_reactor_lv', 'electrolyzer_lv'],
};

interface Module {
  tx: number;
  slots: Partial<Record<Slot, string>>;
}

/** Fills modules of 3 outward from the reactor module: `direction` -1 = west, +1 = east. */
function machineModules(key: string, count: number, direction: 1 | -1): Module[] {
  const modules: Module[] = [];
  for (let n = 0; n < count; n++) {
    const m = Math.floor(n / 3);
    modules[m] ??= { tx: direction * 3 * (m + 1), slots: {} };
    modules[m].slots[SLOT_ORDER[n % 3]] = key;
  }
  return modules;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

export function makeOilBerryLine({ extractors, distilleries }: OilBerryLineOptions): Build {
  for (const [name, n] of [['extractors', extractors], ['distilleries', distilleries]] as const) {
    if (!Number.isInteger(n)) throw new Error(`${name} must be a whole number (got ${n})`);
    if (n < 1) throw new Error(`Need at least 1 of ${name}`);
  }
  if (extractors > MAX_EXTRACTORS_PER_REACTOR) {
    throw new Error(
      `One LV chemical reactor handles the oil of at most ${MAX_EXTRACTORS_PER_REACTOR} extractors (got ${extractors})`,
    );
  }

  const extractorModules = machineModules('fluid_extractor_lv', extractors, -1);
  const distilleryModules = machineModules('distillery_lv', distilleries, 1);
  const reactorModule: Module = { tx: 0, slots: { W: 'chemical_reactor_lv', U: 'electrolyzer_lv' } };
  const modules = [...extractorModules, reactorModule, ...distilleryModules];
  const westTx = extractorModules.at(-1)!.tx;
  const eastTx = distilleryModules.at(-1)!.tx;

  const blocks = new Map<string, PlacedBlock>();
  const netOf = new Map<string, Net>();
  const put = (b: PlacedBlock) => blocks.set(posKey(b.pos), b);
  const pipe = (net: Net, p: Vec3) => netOf.set(posKey(p), net);

  for (const { tx, slots } of modules) {
    put({ pos: [tx, 2, 0], key: 'transformer_mv_lv', facing: 0 });
    put({ pos: [tx, 1, 0], key: 'combustion_generator_mv', facing: 1 });
    for (const [s, key] of Object.entries(slots) as [Slot, string][]) {
      put({ pos: addVec([tx, 0, 0], SLOT_OFFSET[s]), key, facing: FACING[key] });
    }
  }

  // Oil: straight line along the back of the whole row, plus a stub behind each top machine.
  for (const x of range(westTx - 1, eastTx + 1)) pipe('oil', [x, 2, -1]);
  for (const m of [...extractorModules, ...distilleryModules]) if (m.slots.U) pipe('oil', [m.tx, 3, -1]);

  // Berries: line in front of the extractor modules, open at the west end for the crop manager.
  const berryInlet: Vec3 = [westTx - 2, 2, 1];
  for (const x of range(westTx - 2, -2)) pipe('berries', [x, 2, 1]);
  for (const m of extractorModules) if (m.slots.U) pipe('berries', [m.tx, 3, 1]);

  // Sulfuric light fuel: line from in front of the reactor along the distillery modules.
  for (const x of range(-1, eastTx + 1)) pipe('sulfuric', [x, 2, 1]);
  for (const m of distilleryModules) if (m.slots.U) pipe('sulfuric', [m.tx, 3, 1]);

  // Light fuel: line under every generator; the reactor drops light fuel into it from above; the tank
  // connects to an open stub behind the reactor module so both ends stay free for expansion.
  for (const x of range(westTx, eastTx)) pipe('fuel', [x, 0, 0]);
  pipe('fuel', [-1, 1, 0]);
  const fuelOutlet: Vec3 = [0, 0, -1];
  pipe('fuel', fuelOutlet);

  // Cell loop: one pipe touching the reactor's top and the electrolyzer's west face.
  pipe('cells', [-1, 3, 0]);

  // Explicit connections: same-network neighbours, machines this network serves, and the two open ends.
  const openEnds = new Map<string, number>([
    [posKey(berryInlet), 1 << 4],
    [posKey(fuelOutlet), 1 << 2],
  ]);
  for (const [k, net] of netOf) {
    const here = k.split(',').map(Number) as unknown as Vec3;
    let on = openEnds.get(k) ?? 0;
    DIRS.forEach((d, side) => {
      const nk = posKey(addVec(here, d));
      const machine = blocks.get(nk);
      if (netOf.get(nk) === net || (machine && SERVES[net].includes(machine.key))) on |= 1 << side;
    });
    put({ pos: here, key: PIPES[net], manualMask: { forcedOn: on, forcedOff: 63 & ~on } });
  }

  const custom = extractors !== 6 || distilleries !== 17;
  const name = custom ? `oil-berry-line-${extractors}fe-${distilleries}d` : 'oil-berry-line';
  return { version: 1, name, blocks: [...blocks.values()] };
}

/** The line sized for the current farm: ≈5.6 berries/s. */
export const OIL_BERRY_LINE: Build = makeOilBerryLine({ extractors: 6, distilleries: 17 });
