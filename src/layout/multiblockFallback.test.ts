import { buildLine } from './build';
import type { LinePlan, PlanMachine } from './types';
import { LayoutFailure } from './why';

// The tidy layout is the only one that builds multiblocks whole: force it to fail, as on a line too crowded for it.
vi.mock('./tidy', async (original) => ({ ...(await original<typeof import('./tidy')>()), buildTidy: () => undefined }));

const FLUIDS = ['fluid:f1', 'fluid:f2'];
const tower: PlanMachine = {
  nodeId: 'dt', key: 'gt_1126', machine: { key: 'gt_1126', name: 'Distillation Tower', mID: 1126, tier: 'HV', multiblock: true }, tier: 'HV',
  count: 1, eut: 480, avgEut: 480, title: 'Distillation Tower', kept: [], inputs: ['fluid:oil'], outputs: FLUIDS, fluidOutputs: FLUIDS,
  generator: false, multiblock: true,
};
const fluid = (key: string, producers: string[], consumers: string[]): LinePlan['networks'][number] =>
  ({ key, name: key.slice(6), kind: 'fluid', flow: 10, producers, consumers });
const plan: LinePlan = {
  style: 'straight', sliceCount: 0, core: [], notes: [], straight: [tower],
  networks: [fluid('fluid:oil', ['in:oil'], ['dt']), ...FLUIDS.map((k, i) => fluid(k, ['dt'], [`out:${i}`]))],
  markers: [
    { id: 'in:oil', key: 'fluid:oil', dir: 'in', kind: 'fluid' }, { id: 'power', key: 'eu', dir: 'in', kind: 'power' },
    ...FLUIDS.map((k, i) => ({ id: `out:${i}`, key: k, dir: 'out' as const, kind: 'fluid' as const })),
  ],
  power: { tiers: ['HV'], source: { kind: 'outside', tier: 'HV', eut: 480 }, demand: { HV: 480 }, transformers: [] },
};

test('a line whose tidy layout fails never hands over a one-block tower', () => {
  expect(() => buildLine(plan, 'Tower line')).toThrow(LayoutFailure);
  expect(() => buildLine(plan, 'Tower line')).toThrow(/Distillation Tower couldn't be laid out whole/);
});
