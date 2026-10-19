import { buildSchematicTag } from '../export/schematic';
import type { CompoundTag } from '../export/nbt';
import { buildLine } from './build';
import { checkLine } from './check';
import type { LinePlan, PlanMachine } from './types';

vi.setConfig({ testTimeout: 60_000 });

/** An HV mixer on a line whose only generators are MV: it needs a transformer set to step up. */
const pm = (o: Partial<PlanMachine> & Pick<PlanMachine, 'nodeId' | 'key'>): PlanMachine => ({
  machine: { key: o.key, name: o.key, mID: 0, tier: o.tier }, count: 1, eut: 30, title: o.key, kept: [], inputs: [], outputs: [],
  generator: false, multiblock: false, ...o,
});
const plan = (): LinePlan => ({
  style: 'straight', sliceCount: 0, core: [], notes: [],
  straight: [
    pm({ nodeId: 'mix', key: 'gt_583', machine: { key: 'gt_583', name: 'Advanced Mixer II', mID: 583, tier: 'HV' }, tier: 'HV', count: 2, eut: 480, avgEut: 480, title: 'Mixer', inputs: ['fluid:a'], outputs: ['fluid:b'] }),
    pm({ nodeId: 'gen', key: 'combustion_generator_mv', machine: { key: 'combustion_generator_mv', name: 'Advanced Combustion Generator', mID: 1111, tier: 'MV' }, tier: 'MV', count: 4, eut: 128, avgEut: 480, title: 'Fuel generator', inputs: ['fluid:fuel'], generator: true }),
  ],
  networks: [
    { key: 'fluid:a', name: 'A', kind: 'fluid', flow: 10, producers: ['in:a'], consumers: ['mix'] },
    { key: 'fluid:b', name: 'B', kind: 'fluid', flow: 10, producers: ['mix'], consumers: ['out:b'] },
    { key: 'fluid:fuel', name: 'Fuel', kind: 'fluid', flow: 10, producers: ['in:fuel'], consumers: ['gen'] },
  ],
  markers: [
    { id: 'in:a', key: 'fluid:a', dir: 'in', kind: 'fluid' }, { id: 'out:b', key: 'fluid:b', dir: 'out', kind: 'fluid' },
    { id: 'in:fuel', key: 'fluid:fuel', dir: 'in', kind: 'fluid' },
  ],
  power: { tiers: ['HV'], source: { kind: 'generators', tier: 'MV' }, demand: { HV: 480 }, transformers: [] },
});

test('an HV machine on MV generators is powered through a step-up transformer', () => {
  const p = plan();
  const { build } = buildLine(p, 'Mixer line');
  expect(checkLine(build, p)).toEqual([]);
  const ups = build.blocks.filter((b) => b.stepUp);
  expect(ups.length).toBeGreaterThan(0);
  expect(ups.every((b) => b.key === 'transformer_hv_mv')).toBe(true);
  expect(build.notes?.join(' ')).toMatch(/soft mallet/);
});

test('a step-up transformer is pasted in step-up mode', () => {
  const { tag } = buildSchematicTag({ version: 1, name: 't', blocks: [{ pos: [0, 0, 0], key: 'transformer_hv_mv', facing: 2, stepUp: true }] });
  const te = ((tag.value.TileEntities as { value: CompoundTag[] }).value)[0];
  expect((te.value.mWorks as { value: number }).value).toBe(1);
});
