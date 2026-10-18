/**
 * Oil berry → light fuel line, power option B in "row" modules.
 *
 * Each module is an MV→LV transformer (T) with an MV combustion generator directly under it (T's front faces
 * down onto the generator) and up to 3 LV machines touching it: west, east and on top. Modules sit side by
 * side, so the west/east machines form one continuous row and every pipe network is a straight line:
 *
 *   y=3   . U .  . U .  . U .      U = machine on top of T
 *   y=2   W T E  W T E  W T E      row: machines + transformers      back (z=-1): oil line
 *   y=1   . G .  . G .  . G .      G = MV combustion generator       front (z=+1): berries / sulfuric line
 *   y=0   ═════════════════════    light fuel line under every generator, open east end for a tank
 *
 * Top machines reach the back/front lines through one short stub each.
 */
import type { Build, Facing, PlacedBlock, Vec3 } from '../src/model/types';
import { DIRS, addVec, posKey } from '../src/model/directions';

type Slot = 'W' | 'E' | 'U';
const MODULES: Partial<Record<Slot, string>>[] = [
  { W: 'fluid_extractor_lv', E: 'fluid_extractor_lv', U: 'fluid_extractor_lv' },
  { W: 'fluid_extractor_lv', E: 'fluid_extractor_lv', U: 'fluid_extractor_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv' },
  { W: 'chemical_reactor_lv', U: 'electrolyzer_lv' },
];
const LAST = MODULES.length - 1;
const tx = (i: number) => 3 * i + 1;
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

const blocks = new Map<string, PlacedBlock>();
const netOf = new Map<string, Net>();
const put = (b: PlacedBlock) => blocks.set(posKey(b.pos), b);
const pipe = (net: Net, p: Vec3) => netOf.set(posKey(p), net);
const slotOf = (i: number, s: Slot): Vec3 => addVec([tx(i), 0, 0], SLOT_OFFSET[s]);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

MODULES.forEach((slots, i) => {
  put({ pos: [tx(i), 2, 0], key: 'transformer_mv_lv', facing: 0 });
  put({ pos: [tx(i), 1, 0], key: 'combustion_generator_mv', facing: 1 });
  for (const [s, key] of Object.entries(slots) as [Slot, string][]) put({ pos: slotOf(i, s), key, facing: FACING[key] });
});

const hasTop = (i: number) => MODULES[i].U !== undefined;
const isDistilleryModule = (i: number) => MODULES[i].W === 'distillery_lv';
const isExtractorModule = (i: number) => MODULES[i].W === 'fluid_extractor_lv';
const crX = slotOf(LAST, 'W')[0];

// Oil: straight line behind every extractor/distillery module, plus a stub behind each top machine.
const oilModules = range(0, LAST - 1);
for (const x of range(tx(oilModules[0]) - 1, tx(oilModules.at(-1)!) + 1)) pipe('oil', [x, 2, -1]);
for (const i of oilModules) if (hasTop(i)) pipe('oil', [tx(i), 3, -1]);

// Berries: straight line in front of the extractor modules, open at the west end for the crop manager.
const berryModules = range(0, LAST).filter(isExtractorModule);
const berryWest = tx(berryModules[0]) - 2;
for (const x of range(berryWest, tx(berryModules.at(-1)!) + 1)) pipe('berries', [x, 2, 1]);
for (const i of berryModules) pipe('berries', [tx(i), 3, 1]);

// Sulfuric light fuel: straight line in front of the distillery modules, ending in front of the reactor.
const distModules = range(0, LAST).filter(isDistilleryModule);
for (const x of range(tx(distModules[0]) - 1, crX)) pipe('sulfuric', [x, 2, 1]);
for (const i of distModules) if (hasTop(i)) pipe('sulfuric', [tx(i), 3, 1]);

// Light fuel: line under every generator; the reactor drops its light fuel into it; open east end for a tank.
const fuelEast = tx(LAST) + 2;
for (const x of range(tx(0), fuelEast)) pipe('fuel', [x, 0, 0]);
pipe('fuel', [crX, 1, 0]);

// Cell loop: one pipe touching the reactor's top and the electrolyzer's west face.
pipe('cells', [crX, 3, 0]);

// Explicit connections: same-network neighbours, machines this network serves, and the two open ends.
const openEnds = new Map<string, number>([
  [posKey([berryWest, 2, 1]), 1 << 4],
  [posKey([fuelEast, 0, 0]), 1 << 5],
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

export const OIL_BERRY_LINE: Build = { version: 1, name: 'oil-berry-line', blocks: [...blocks.values()] };
