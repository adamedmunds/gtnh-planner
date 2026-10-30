import { buildLine } from './build';
import { checkLine } from './check';
import { LayoutFailure, explainFailures } from './why';
import type { LinePlan, PlanMachine } from './types';

test('raw reasons become plain words with something to try, most common first, repeats grouped', () => {
  const out = explainFailures([
    'no room to join the Chlorine runs',
    'no free face on the LV Chemical Reactor for Hydrochloric Acid',
    'no room to join the Chlorine runs',
    'core: no room to run Oil Berry in the core',
    'no room to join the Chlorine runs',
  ]);
  expect(out[0]).toMatchObject({ count: 3 });
  expect(out[0].text).toMatch(/Chlorine/);
  expect(out[0].advice).toMatch(/Straight line|split/i);
  const face = out.find((r) => /Chemical Reactor/.test(r.text))!;
  expect(face.text).toMatch(/more pipes than free sides/);
  expect(face.advice).toMatch(/fewer inputs/);
  expect(out.find((r) => /core/.test(r.text))!.text).toMatch(/Oil Berry/);
});

test('generators that fall short and mixed voltages get their own advice', () => {
  const [gens] = explainFailures(['not enough generators']);
  expect(gens.advice).toMatch(/generators|outside/i);
  const [volts] = explainFailures(['machines of two voltages would share one power layer']);
  expect(volts.advice).toMatch(/voltage/i);
});

test('a line no layout can fit throws a LayoutFailure that says why and what to try', () => {
  // One machine with five fluid inputs and three fluid outputs: more pipes than a block has sides.
  const keys = Array.from({ length: 8 }, (_, i) => `fluid:f${i}`);
  const m: PlanMachine = {
    nodeId: 'mix', key: 'chemical_reactor_lv', machine: { key: 'chemical_reactor_lv', name: 'Mixer', mID: 421, tier: 'LV' }, tier: 'LV',
    count: 2, eut: 30, avgEut: 120, title: 'Mixer', kept: [], inputs: keys.slice(0, 5), outputs: keys.slice(5), generator: false, multiblock: false,
  };
  const plan: LinePlan = {
    style: 'straight', sliceCount: 0, core: [], straight: [m], notes: [],
    networks: keys.map((k, i) => ({ key: k, name: `Fluid ${i}`, kind: 'fluid', flow: 10, producers: i < 5 ? [`in:${k}`] : ['mix'], consumers: i < 5 ? ['mix'] : [`out:${k}`] })),
    markers: [...keys.map((k, i) => ({ id: `${i < 5 ? 'in' : 'out'}:${k}`, key: k, dir: (i < 5 ? 'in' : 'out') as 'in' | 'out', kind: 'fluid' as const })), { id: 'power', key: 'eu', dir: 'in', kind: 'power' }],
    power: { tiers: ['LV'], source: { kind: 'outside', tier: 'LV', eut: 120 }, demand: { LV: 120 }, transformers: [] },
  };
  let error: unknown;
  try {
    buildLine(plan, 'Mixer line');
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(LayoutFailure);
  const f = error as LayoutFailure;
  expect(f.message).toMatch(/^Couldn't lay out this line/);
  expect(f.reasons.length).toBeGreaterThan(0);
  expect(f.reasons.some((r) => /Mixer|Chemical Reactor/.test(r.text))).toBe(true);
  expect(f.reasons.every((r) => r.advice.length > 0)).toBe(true);
}, 60_000);

test('a machine above the line\'s power voltage stops the layout with why and what to do', () => {
  const mixer: PlanMachine = {
    nodeId: 'mix', key: 'gt_583', machine: { key: 'gt_583', name: 'Advanced Mixer II', mID: 583, tier: 'HV' }, tier: 'HV',
    count: 1, eut: 480, avgEut: 480, title: 'Mixer', kept: [], inputs: [], outputs: [], generator: false, multiblock: false,
  };
  const plan: LinePlan = {
    style: 'straight', sliceCount: 0, core: [], straight: [mixer], notes: [], networks: [], markers: [],
    power: { tiers: ['HV'], source: { kind: 'outside', tier: 'MV', eut: 480 }, demand: { HV: 480 }, transformers: [] },
  };
  let error: unknown;
  try {
    buildLine(plan, 'Diesel line');
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(LayoutFailure);
  const [reason] = (error as LayoutFailure).reasons;
  expect(reason.text).toMatch(/Advanced Mixer II needs HV power.*MV/);
  expect(reason.tips.join(' ')).toMatch(/HV generators|from outside/);
});

test('a layout the checker rejects is never handed over: it fails with the problem', () => {
  const [r] = explainFailures(['check: No power reaches the Advanced Mixer II at (0, 0, -1)']);
  expect(r.text).toMatch(/No power reaches the Advanced Mixer II/);
});

test('the same mixer on MV generators is stepped up instead', () => {
  const mixer: PlanMachine = {
    nodeId: 'mix', key: 'gt_583', machine: { key: 'gt_583', name: 'Advanced Mixer II', mID: 583, tier: 'HV' }, tier: 'HV',
    count: 1, eut: 480, avgEut: 480, title: 'Mixer', kept: [], inputs: [], outputs: [], generator: false, multiblock: false,
  };
  const gen: PlanMachine = {
    nodeId: 'gen', key: 'combustion_generator_mv', machine: { key: 'combustion_generator_mv', name: 'Advanced Combustion Generator', mID: 1111, tier: 'MV' },
    tier: 'MV', count: 4, eut: 128, avgEut: 501, title: 'Diesel generator', kept: [], inputs: [], outputs: [], generator: true, multiblock: false,
  };
  const plan: LinePlan = {
    style: 'straight', sliceCount: 0, core: [], straight: [mixer, gen], notes: [], networks: [], markers: [],
    power: { tiers: ['HV'], source: { kind: 'generators', tier: 'MV' }, demand: { HV: 480 }, transformers: [] },
  };
  const { build } = buildLine(plan, 'Diesel line');
  expect(checkLine(build, plan)).toEqual([]);
  expect(build.blocks.some((b) => b.stepUp)).toBe(true);
}, 60_000);

test('a multiblock laid out as one block is explained as not fitting whole', () => {
  const [r] = explainFailures(['check: The Distillation Tower at (1, 0, -1) is a single block — it needs its casings and hatches to form']);
  expect(r.text).toBe("The Distillation Tower couldn't be laid out whole: there was no room for its casings and hatches");
  expect(r.advice).toMatch(/build the Distillation Tower yourself beside the line/);
});
