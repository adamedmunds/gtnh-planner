import { registerMachines } from '../catalog';
import { makeOilBerryLine } from '../presets/oilBerryLine';
import type { Build, PlacedBlock } from '../model/types';
import { K } from '../test/oilBerryDb';
import { checkLine } from './check';
import type { GeneratedLine, LinePlan, PlanMachine } from './types';

const pm = (nodeId: string, key: string, tier: string, inputs: string[], outputs: string[], generator = false): PlanMachine => ({
  nodeId, key, machine: { key, name: key, mID: 0, tier }, tier, count: 1, eut: 0, title: key, kept: [], inputs, outputs, generator, multiblock: false,
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
    // The cells pipe carries three kinds of cell; the reactor should only take Hydrogen Cells from it.
    { pos: [-1, 2, 0], side: 1, kind: 'itemFilter', item: K.hydrogenCell },
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

describe('front faces (GregTech basic machines have a front and a separate output face)', () => {
  test('a pipe attached to a machine front is reported', () => {
    const b = preset();
    const fe = b.blocks.find((p) => p.key === 'fluid_extractor_lv')!;
    fe.mainFacing = fe.facing; // front on the output side: nothing could come out
    expect(checkLine(b, presetPlan).join(' | ')).toMatch(/front/i);
  });

  test('a front facing up or down is reported', () => {
    const b = preset();
    const fe = b.blocks.find((p) => p.key === 'fluid_extractor_lv')!;
    fe.mainFacing = 1;
    expect(checkLine(b, presetPlan).join(' | ')).toMatch(/front .*sideways|front .*horizontal/i);
  });

  test('a mixed item pipe feeding two places needs item filters', () => {
    const b = { ...preset(), covers: preset().covers!.filter((c) => c.kind !== 'itemFilter') };
    expect(checkLine(b, presetPlan).join(' | ')).toMatch(/Item Filter cover set to Hydrogen Cell/);
  });
});

describe('a network may be several pipes, each joining makers and users', () => {
  const plan: LinePlan = {
    ...presetPlan,
    straight: [pm('fe', 'fluid_extractor_lv', 'LV', [K.oilBerry], [K.oil]), pm('dist', 'distillery_lv', 'LV', [K.oil], [K.sulfuricLightFuel])],
    networks: [{ key: K.oil, name: 'Oil', kind: 'fluid', flow: 1, producers: ['fe'], consumers: ['dist'] }],
  };
  /** Extractor → pipe → distillery along x at height z. */
  const pair = (z: number, withExtractor = true): PlacedBlock[] => [
    ...(withExtractor ? [{ pos: [0, 0, z], key: 'fluid_extractor_lv', role: 'fe', facing: 5, mainFacing: 2 } as PlacedBlock] : []),
    { pos: [1, 0, z], key: 'bronze_pipe_small', manualMask: { forcedOn: 0b110000, forcedOff: 0b001111 } },
    { pos: [2, 0, z], key: 'distillery_lv', role: 'dist', facing: 1, mainFacing: 2 },
  ];
  const build = (blocks: PlacedBlock[]): Build => ({ version: 1, name: 't', blocks });

  test('two separate extractor → distillery pipes are fine', () => {
    expect(checkLine(build([...pair(0), ...pair(5)]), plan).join('\n')).not.toMatch(/Oil/);
  });

  test("a distillery whose pipe comes from no extractor is reported", () => {
    expect(checkLine(build([...pair(0), ...pair(5, false)]), plan).join('\n')).toMatch(/Oil is split into pipes that don't join/);
  });
});

describe('burn risk: higher voltage touching a lower-rated cable, connected or not', () => {
  const plan: LinePlan = { ...presetPlan, straight: [pm('gen', 'combustion_generator_mv', 'MV', [], [], true)], networks: [] };
  const build = (blocks: PlacedBlock[]): Build => ({ version: 1, name: 't', blocks });
  const off = { forcedOn: 0, forcedOff: 0b111111 };
  const gen: PlacedBlock = { pos: [0, 0, 0], key: 'combustion_generator_mv', role: 'gen', facing: 5 };
  const mvRun: PlacedBlock[] = [1, 2, 3].map((x) => ({ pos: [x, 0, 0], key: 'annealed_copper_cable_1x', manualMask: { forcedOn: 0b110000, forcedOff: 0b001111 } }));

  test('an LV cable beside a live MV cable is reported', () => {
    const lv: PlacedBlock = { pos: [2, 0, 1], key: 'tin_cable_1x', manualMask: off };
    expect(checkLine(build([gen, ...mvRun, lv]), plan).join('\n')).toMatch(/Tin Cable at \(2, 0, 1\).*burn/);
  });

  test("an LV cable against a generator's output face is reported", () => {
    const lv: PlacedBlock = { pos: [1, 0, 0], key: 'tin_cable_1x', manualMask: off };
    expect(checkLine(build([gen, lv]), plan).join('\n')).toMatch(/burn/);
  });

  test("an LV cable against a generator's other faces is fine", () => {
    const lv: PlacedBlock = { pos: [0, 1, 0], key: 'tin_cable_1x', manualMask: off };
    expect(checkLine(build([gen, ...mvRun, lv]), plan).join('\n')).not.toMatch(/burn/);
  });
});

describe('multiblock ports', () => {
  beforeAll(() => registerMachines([{ key: 'gt_1126', name: 'Distillation Tower', mID: 1126, tier: 'HV', multiblock: true }]));
  const A = 'fluid:a';
  const B = 'fluid:b';
  const C = 'fluid:c';
  const plan: LinePlan = {
    ...presetPlan,
    straight: [{ ...pm('mb', 'gt_1126', 'HV', [A], [B, C]), multiblock: true, eut: 480 }],
    networks: [
      { key: A, name: 'Fluid A', kind: 'fluid', flow: 1, producers: ['a_in'], consumers: ['mb'] },
      { key: B, name: 'Fluid B', kind: 'fluid', flow: 1, producers: ['mb'], consumers: ['b_out'] },
      { key: C, name: 'Fluid C', kind: 'fluid', flow: 1, producers: ['mb'], consumers: ['c_out'] },
    ],
    power: { tiers: ['HV'], source: { kind: 'outside', tier: 'HV', eut: 480 }, demand: { HV: 480 }, transformers: [] },
  };
  const pipe = (pos: [number, number, number]): PlacedBlock => ({ pos, key: 'steel_pipe_small' });
  // A controller with an input hatch east, two output hatches west and south, an energy hatch north; each pipe runs to a marker.
  const multiblock = (): Build => ({
    version: 1, name: 'mb',
    blocks: [
      { pos: [0, 0, 0], key: 'gt_1126', role: 'mb' },
      { pos: [1, 0, 0], key: 'hatch_input_lv', role: 'mb', facing: 5, port: { kind: 'in', keys: [A] } },
      { pos: [-1, 0, 0], key: 'hatch_output_lv', role: 'mb', facing: 4, port: { kind: 'out', keys: [B] } },
      { pos: [0, 0, 1], key: 'hatch_output_lv', role: 'mb', facing: 3, port: { kind: 'out', keys: [C] } },
      { pos: [0, 0, -1], key: 'hatch_energy_hv', role: 'mb', facing: 2, port: { kind: 'energy', keys: [] } },
      pipe([2, 0, 0]), { pos: [3, 0, 0], key: 'marker_fluid_in', role: 'a_in' },
      pipe([-2, 0, 0]), { pos: [-3, 0, 0], key: 'marker_fluid_out', role: 'b_out' },
      pipe([0, 0, 2]), { pos: [0, 0, 3], key: 'marker_fluid_out', role: 'c_out' },
      { pos: [0, 0, -2], key: 'electrum_cable_1x' }, { pos: [0, 0, -3], key: 'marker_power_in' },
    ],
  });
  const hatchAt = (b: Build, x: number, z: number) => b.blocks.find((p) => p.pos[0] === x && p.pos[2] === z)!;

  test('a multiblock passes when each port has its own pipe', () => {
    expect(checkLine(multiblock(), plan)).toEqual([]);
  });

  test('a multiblock output pipe on the wrong hatch is caught', () => {
    const b = multiblock();
    hatchAt(b, 0, 1).facing = 2; // the Fluid C hatch now faces the controller, away from its pipe
    expect(checkLine(b, plan).join(' | ')).toMatch(/Fluid C can't get out of the .*Output Hatch/);
  });

  test('an energy hatch powered from its side is not powered', () => {
    const b = multiblock();
    hatchAt(b, 0, -1).facing = 3; // the cable now meets its side, not its front
    expect(checkLine(b, plan).join(' | ')).toMatch(/No power reaches the .*Energy Hatch/);
  });

  test('an output hatch with nothing to output needs no pipe', () => {
    const b = multiblock();
    hatchAt(b, 0, 1).port = { kind: 'out', keys: [] };
    b.blocks = b.blocks.filter((p) => p.pos[2] < 2 || p.pos[0] !== 0);
    expect(checkLine(b, { ...plan, networks: plan.networks.filter((n) => n.key !== C) })).toEqual([]);
  });
});
