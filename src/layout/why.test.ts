import { buildLine } from './build';
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
