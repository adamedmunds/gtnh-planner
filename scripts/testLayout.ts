import type { Build, Facing, PlacedBlock } from '../src/model/types';

const blocks: PlacedBlock[] = [];
const machine = (x: number, key: string, facing: Facing = 3) => blocks.push({ pos: [x, 0, 0], key, facing });

machine(0, 'fluid_extractor_lv');
machine(2, 'distillery_lv');
machine(4, 'chemical_reactor_lv');
machine(6, 'electrolyzer_lv');
machine(8, 'extractor_lv');
machine(10, 'distillery_mv');
machine(12, 'distillery_hv');
machine(14, 'distillery_lv', 5);

for (let x = 0; x <= 14; x++) blocks.push({ pos: [x, 0, -1], key: 'tin_cable_1x' });
for (let x = 0; x <= 8; x++) blocks.push({ pos: [x, 1, 0], key: 'bronze_pipe_normal' });
for (let x = 0; x <= 3; x++) blocks.push({ pos: [x, 0, 2], key: 'tin_item_pipe_small' });

export const TEST_LAYOUT: Build = { version: 1, name: 'test-hologram', blocks };
