/**
 * Oil berry → light fuel line, power option B: 7 modules, each an MV→LV transformer (T) with up to 4 LV
 * machines touching it (west, east, above, below) and an MV combustion generator directly behind it (north).
 *
 * Axes: x runs along the line, y is up, z = -2 generator fuel line, -1 back plane, 0 machines, +1 front plane.
 *
 *   back plane  (z=-1): oil ring (modules 0-5) collects extractor output and feeds distilleries;
 *                       module 6 ring carries light fuel from the chemical reactor.
 *   front plane (z=+1): berry item pipes (modules 0-1) and the sulfuric light fuel pipes (distilleries → CR).
 *   z=-2:               light fuel line along the back of every generator, open at the east end for storage.
 */
import type { Build, Facing, PlacedBlock, Vec3 } from '../src/model/types';
import { posKey } from '../src/model/directions';

const OIL_PIPE = 'bronze_pipe_normal';
const SULFURIC_PIPE = 'bronze_pipe_normal';
const FUEL_PIPE = 'steel_pipe_small';
const BERRY_PIPE = 'tin_item_pipe_normal';
const CELL_PIPE = 'tin_item_pipe_small';

const DOWN = 1 << 0, UP = 1 << 1, SOUTH = 1 << 3, WEST = 1 << 4, EAST = 1 << 5;

// Output sides (mFacing) per machine.
const FACING: Record<string, Facing> = {
  fluid_extractor_lv: 2, // oil out the back
  distillery_lv: 3, // sulfuric light fuel out the front
  chemical_reactor_lv: 1, // cells up into the cell loop pipe (light fuel leaves the back via a pump cover)
  electrolyzer_lv: 4, // hydrogen cells west into the cell loop pipe
};

type Slot = 'W' | 'E' | 'U' | 'D';
const MODULES: Partial<Record<Slot, string>>[] = [
  { W: 'fluid_extractor_lv', E: 'fluid_extractor_lv', U: 'fluid_extractor_lv', D: 'fluid_extractor_lv' },
  { W: 'fluid_extractor_lv', D: 'fluid_extractor_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv', D: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv', D: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv', D: 'distillery_lv' },
  { W: 'distillery_lv', E: 'distillery_lv', U: 'distillery_lv' },
  { W: 'chemical_reactor_lv', U: 'electrolyzer_lv' },
];
const LAST = MODULES.length - 1;

const tx = (i: number) => 3 * i + 1;
const SLOT_OFFSET: Record<Slot, Vec3> = { W: [-1, 1, 0], E: [1, 1, 0], U: [0, 2, 0], D: [0, 0, 0] };
const slotPos = (i: number, s: Slot): Vec3 => [tx(i) + SLOT_OFFSET[s][0], SLOT_OFFSET[s][1], SLOT_OFFSET[s][2]];

const blocks = new Map<string, PlacedBlock>();
const put = (b: PlacedBlock) => blocks.set(posKey(b.pos), b);
const forceOff = (p: Vec3, bits: number) => {
  const b = blocks.get(posKey(p))!;
  const m = b.manualMask ?? { forcedOn: 0, forcedOff: 0 };
  b.manualMask = { forcedOn: m.forcedOn, forcedOff: m.forcedOff | bits };
};
const forceOn = (p: Vec3, bits: number) => {
  const b = blocks.get(posKey(p))!;
  const m = b.manualMask ?? { forcedOn: 0, forcedOff: 0 };
  b.manualMask = { forcedOn: m.forcedOn | bits, forcedOff: m.forcedOff };
};

// Modules: transformer, generator, machines.
MODULES.forEach((slots, i) => {
  put({ pos: [tx(i), 1, 0], key: 'transformer_mv_lv', facing: 2 });
  put({ pos: [tx(i), 1, -1], key: 'combustion_generator_mv', facing: 3 });
  for (const [s, key] of Object.entries(slots) as [Slot, string][]) put({ pos: slotPos(i, s), key, facing: FACING[key] });
});

// Back plane rings around each generator.
MODULES.forEach((_, i) => {
  const key = i === LAST ? FUEL_PIPE : OIL_PIPE;
  for (let x = tx(i) - 1; x <= tx(i) + 1; x++)
    for (let y = 0; y <= 2; y++) if (!(x === tx(i) && y === 1)) put({ pos: [x, y, -1], key });
  if (i !== LAST) {
    // Oil must not reach the generators.
    forceOff([tx(i) - 1, 1, -1], EAST);
    forceOff([tx(i) + 1, 1, -1], WEST);
    forceOff([tx(i), 2, -1], DOWN);
    forceOff([tx(i), 0, -1], UP);
  }
});
// Keep the oil ring (module 5) and the light fuel ring (module 6) apart.
for (let y = 0; y <= 2; y++) forceOff([tx(LAST - 1) + 1, y, -1], EAST);
// Light fuel must not be pushed into the electrolyzer's back.
forceOff([tx(LAST), 2, -1], SOUTH);

// Generator fuel line behind every generator; joins the light fuel ring at module 6's west column.
const fuelLineEnd = tx(LAST) + 2;
for (let x = tx(0); x <= fuelLineEnd; x++) {
  put({ pos: [x, 1, -2], key: FUEL_PIPE });
  const isGenColumn = MODULES.some((_, i) => tx(i) === x);
  if (!isGenColumn && x !== tx(LAST) - 1) forceOff([x, 1, -2], SOUTH);
}
forceOn([fuelLineEnd, 1, -2], EAST); // open end: connect a tank here for the net light fuel output

// Front plane: berry item pipes for the extractors (module 0 ring + module 1's west and bottom slots).
for (let x = tx(0) - 1; x <= tx(0) + 1; x++)
  for (let y = 0; y <= 2; y++) if (!(x === tx(0) && y === 1)) put({ pos: [x, y, 1], key: BERRY_PIPE });
put({ pos: [tx(1) - 1, 1, 1], key: BERRY_PIPE });
put({ pos: [tx(1) - 1, 0, 1], key: BERRY_PIPE });
put({ pos: [tx(1), 0, 1], key: BERRY_PIPE });
put({ pos: [tx(0) - 2, 1, 1], key: BERRY_PIPE });
forceOn([tx(0) - 2, 1, 1], WEST); // open end: berries in from the crop manager

// Front plane: sulfuric light fuel pipes from module 1's distilleries to the chemical reactor.
for (let x = tx(1); x <= tx(LAST) - 1; x++)
  for (let y = 0; y <= 2; y++) {
    const p: Vec3 = [x, y, 1];
    if (blocks.has(posKey(p))) continue; // berry pipe
    if (MODULES.some((_, i) => tx(i) === x) && y === 1) continue; // in front of a transformer
    put({ pos: p, key: SULFURIC_PIPE });
  }

// Cell loop: one item pipe touching the chemical reactor's top and the electrolyzer's west side.
put({ pos: [tx(LAST) - 1, 2, 0], key: CELL_PIPE });

export const OIL_BERRY_LINE: Build = { version: 1, name: 'oil-berry-line', blocks: [...blocks.values()] };
