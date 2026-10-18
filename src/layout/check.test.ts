import { makeOilBerryLine } from '../presets/oilBerryLine';
import type { Build, PlacedBlock } from '../model/types';
import { K } from '../test/oilBerryDb';
import { checkLine } from './check';
import type { GeneratedLine, LinePlan, PlanMachine } from './types';

const pm = (nodeId: string, key: string, tier: string, inputs: string[], outputs: string[], generator = false): PlanMachine => ({
  nodeId, key, machine: { key, name: key, mID: 0, tier }, tier, count: 1, inputs, outputs, generator, multiblock: false,
});

/** A plan describing the hand-made oil berry preset (its open pipe ends have no markers). */
const presetPlan: LinePlan = {
  style: 'straight',
  sliceCount: 0,
  core: [],
  straight: [
    pm('fe', 'fluid_extractor_lv', 'LV', [K.oilBerry], [K.oil]),
    pm('dist', 'distillery_lv', 'LV', [K.oil], [K.sulfuricLightFuel]),
    pm('cr', 'chemical_reactor_lv', 'LV', [K.hydrogenCell, K.sulfuricLightFuel], [K.h2sCell, K.emptyCell, K.lightFuel]),
    pm('el', 'electrolyzer_mv', 'MV', [K.h2sCell, K.emptyCell], [K.hydrogenCell]),
    pm('gen', 'combustion_generator_mv', 'MV', [K.lightFuel], [], true),
  ],
  networks: [
    { key: K.oil, name: 'Oil', kind: 'fluid', flow: 557, producers: ['fe'], consumers: ['dist'] },
    { key: K.sulfuricLightFuel, name: 'Sulfuric Light Fuel', kind: 'fluid', flow: 557, producers: ['dist'], consumers: ['cr'] },
    { key: K.lightFuel, name: 'Light Fuel', kind: 'fluid', flow: 557, producers: ['cr'], consumers: ['gen'] },
    { key: K.h2sCell, name: 'Hydrogen Sulfide Cell', kind: 'item', flow: 0.05, producers: ['cr'], consumers: ['el'] },
    { key: K.emptyCell, name: 'Empty Cell', kind: 'item', flow: 0.05, producers: ['cr'], consumers: ['el'] },
    { key: K.hydrogenCell, name: 'Hydrogen Cell', kind: 'item', flow: 0.1, producers: ['el'], consumers: ['cr'] },
  ],
  markers: [],
  power: { tiers: ['LV', 'MV'], source: { kind: 'generators', tier: 'MV' }, demand: {}, transformers: [] },
  notes: [],
};

const preset = (): Build => ({
  ...makeOilBerryLine({ extractors: 6, distilleries: 17 }),
  // The reactor's Light Fuel leaves through a pump cover underneath; the reactor and electrolyzer take their cells in
  // through their output face, which GregTech allows only with "input from output side" set (screwdriver).
  covers: [
    { pos: [-1, 2, 0], side: 0, kind: 'pump' },
    { pos: [-1, 2, 0], side: 1, kind: 'inputFromOutput' },
    { pos: [1, 3, 0], side: 4, kind: 'inputFromOutput' },
  ],
});
const at = (b: Build, x: number, y: number, z: number) => b.blocks.find((p) => p.pos[0] === x && p.pos[1] === y && p.pos[2] === z)!;

test('the hand-made oil berry preset passes', () => {
  expect(checkLine(preset(), presetPlan)).toEqual([]);
});

test("without its pump cover the reactor's Light Fuel has no way out", () => {
  const b = { ...preset(), covers: preset().covers!.filter((c) => c.kind !== 'pump') };
  expect(checkLine(b, presetPlan).join('\n')).toMatch(/Light Fuel.*Chemical Reactor|chemical_reactor_lv/);
});

test('an LV machine fed by an MV generator is reported', () => {
  const b = preset();
  // The electrolyzer sits on its own MV generator; swap it for an LV distillery-type block of the electrolyzer node.
  const el = at(b, 1, 3, 0);
  el.key = 'electrolyzer_lv';
  const plan: LinePlan = { ...presetPlan, straight: presetPlan.straight!.map((m) => (m.nodeId === 'el' ? { ...m, key: 'electrolyzer_lv', tier: 'LV' } : m)) };
  expect(checkLine(b, plan).join('\n')).toMatch(/LV.*MV|too much voltage/i);
});

test('a pipe joining two fluids is reported', () => {
  const b = preset();
  // Bridge the oil line (z=-1) and the sulfuric line (z=+1) just east of the electrolyzer column.
  const bridge: PlacedBlock[] = [
    { pos: [2, 3, -1], key: 'bronze_pipe_normal', manualMask: { forcedOn: 0b111111, forcedOff: 0 } },
    { pos: [2, 4, -1], key: 'bronze_pipe_normal', manualMask: { forcedOn: 0b111111, forcedOff: 0 } },
    { pos: [2, 4, 0], key: 'bronze_pipe_normal', manualMask: { forcedOn: 0b111111, forcedOff: 0 } },
    { pos: [2, 4, 1], key: 'bronze_pipe_normal', manualMask: { forcedOn: 0b111111, forcedOff: 0 } },
    { pos: [2, 3, 1], key: 'bronze_pipe_normal', manualMask: { forcedOn: 0b111111, forcedOff: 0 } },
  ];
  const blocks = b.blocks.filter((p) => !bridge.some((q) => q.pos.join() === p.pos.join()));
  // Open the two line pipes towards the bridge (their up side is forced off).
  for (const p of blocks) if (p.pos.join() === '2,2,-1' || p.pos.join() === '2,2,1') p.manualMask = { forcedOn: 0b111111, forcedOff: 0 };
  expect(checkLine({ ...b, blocks: [...blocks, ...bridge] }, presetPlan).join('\n')).toMatch(/joins .*Oil|mixes/i);
});

test('a machine whose output faces nothing is reported', () => {
  const b = preset();
  const fe = b.blocks.find((p) => p.key === 'fluid_extractor_lv')!;
  fe.facing = fe.facing === 2 ? 3 : 2; // turn it to face the berry line instead of the oil line
  expect(checkLine(b, presetPlan).join('\n')).toMatch(/Fluid Extractor|fluid_extractor_lv/);
});

describe('generated builds', () => {
  const slice: PlacedBlock[] = [{ pos: [0, 0, -1], key: 'distillery_lv', facing: 1, role: 'dist' }];
  const gen = (blocks: PlacedBlock[], extra: Partial<GeneratedLine> = {}): Build => ({
    version: 1, name: 'g', blocks,
    generated: { style: 'modular', sliceLength: 2, sliceCount: 2, left: 0, right: 2, leftStart: 0, rightStart: 0, template: slice, ...extra },
  });
  const empty: LinePlan = { ...presetPlan, style: 'modular', straight: undefined, slice: [presetPlan.straight![1]], networks: [] };

  test('a block in the walkway is reported', () => {
    const b = gen([...slice, { pos: [2, 0, -1], key: 'distillery_lv', facing: 1, role: 'dist' }, { pos: [0, 1, 0], key: 'bronze_pipe_small' }]);
    expect(checkLine(b, empty).join('\n')).toMatch(/walkway/i);
  });

  test('two slices that differ are reported', () => {
    const b = gen([...slice, { pos: [2, 0, -1], key: 'distillery_lv', facing: 3, role: 'dist' }]);
    expect(checkLine(b, empty).join('\n')).toMatch(/slice 2 .*differ|not identical/i);
  });
});

test('a machine taking input through its output face needs the screwdriver setting', () => {
  const b = { ...preset(), covers: preset().covers!.filter((c) => c.kind !== 'inputFromOutput') };
  expect(checkLine(b, presetPlan).join(' | ')).toMatch(/input from output side/i);
});
