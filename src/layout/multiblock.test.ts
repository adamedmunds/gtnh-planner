import { structureFor, type Structure } from './multiblock';
import type { PlanMachine } from './types';

const mb = (mID: number, over: Partial<PlanMachine> = {}): PlanMachine => ({
  nodeId: 'n', key: `gt_${mID}`, machine: { key: `gt_${mID}`, name: 'Multiblock', mID, multiblock: true }, tier: 'HV',
  count: 1, eut: 480, title: 'Multiblock', kept: [], inputs: [], outputs: [], generator: false, multiblock: true, ...over,
});
const FLUIDS = ['fluid:a', 'fluid:b', 'fluid:c', 'fluid:d', 'fluid:e'];
const tower = (fluidOutputs: string[], over: Partial<PlanMachine> = {}) =>
  structureFor(mb(1126, { inputs: ['fluid:crude'], outputs: fluidOutputs, fluidOutputs, ...over }))!;
const countKey = (s: Structure, key: string) => s.blocks.filter((b) => b.key === key).length;
const at = (s: Structure, x: number, y: number, z: number) => s.blocks.find((b) => b.rel[0] === x && b.rel[1] === y && b.rel[2] === z);

describe('multiblock structures', () => {
  it('a distillation tower is as tall as its fluid outputs plus one', () => {
    const s = tower(FLUIDS);
    expect(s.size).toEqual([3, 6, 3]);
    for (let y = 1; y <= 4; y++) {
      expect(at(s, 1, y, 1)).toBeUndefined();
      expect(s.ports.some((p) => p.rel[0] === 1 && p.rel[1] === y && p.rel[2] === 1)).toBe(false);
    }
    expect(at(s, 1, 5, 1)?.key).toBe('casing_clean_stainless');
    expect(countKey(s, 'casing_clean_stainless')).toBeGreaterThanOrEqual(7 * 6 - 5);
    expect(at(s, 1, 0, 2)?.key).toBe('gt_1126');
  });

  it('each output hatch sits on the layer of its fluid, in recipe order', () => {
    const s = tower(FLUIDS);
    for (let n = 1; n <= 5; n++) {
      const outs = s.ports.filter((p) => p.kind === 'out' && p.rel[1] === n);
      expect(outs).toHaveLength(1);
      expect(outs[0].keys).toEqual([FLUIDS[n - 1]]);
      expect(outs[0].key).toBe('hatch_output_lv');
    }
  });

  it('falls back to the fluid outputs when fluidOutputs is missing', () => {
    const s = structureFor(mb(1126, { outputs: ['item:x', 'fluid:a', 'fluid:b'] }))!;
    expect(s.size).toEqual([3, 3, 3]);
    expect(s.ports.find((p) => p.kind === 'out' && p.rel[1] === 2)?.keys).toEqual(['fluid:b']);
  });

  it('a one-output tower is still three tall, with an empty output hatch', () => {
    const s = tower(['fluid:a']);
    expect(s.size[1]).toBe(3);
    const outs = s.ports.filter((p) => p.kind === 'out' && p.rel[1] > 0);
    expect(outs.map((p) => p.rel[1]).sort()).toEqual([1, 2]);
    expect(outs.find((p) => p.rel[1] === 2)?.keys).toEqual([]);
  });

  it('a tower with an item output gets an output bus on the bottom layer', () => {
    const s = tower(['fluid:a'], { outputs: ['fluid:a', 'item:sulfur'] });
    const bus = s.ports.find((p) => p.kind === 'out' && p.key === 'bus_output_lv')!;
    expect(bus.rel[1]).toBe(0);
    expect(bus.keys).toEqual(['item:sulfur']);
  });

  it('the energy hatch matches the recipe tier', () => {
    expect(tower(FLUIDS).ports.find((p) => p.kind === 'energy')?.key).toBe('hatch_energy_hv');
    expect(tower(FLUIDS, { tier: 'MV' }).ports.find((p) => p.kind === 'energy')?.key).toBe('hatch_energy_mv');
    expect(tower(FLUIDS, { tier: 'ULV' }).ports.find((p) => p.kind === 'energy')?.key).toBe('hatch_energy_lv');
  });

  it('a large chemical reactor has exactly one coil and its PTFE pipe in the centre', () => {
    const s = structureFor(mb(1169, { inputs: ['fluid:a', 'item:b'], outputs: ['fluid:c'] }))!;
    expect(s.size).toEqual([3, 3, 3]);
    expect(countKey(s, 'coil_cupronickel')).toBe(1);
    expect(at(s, 1, 1, 1)?.key).toBe('casing_ptfe_pipe');
    expect(countKey(s, 'casing_chemically_inert')).toBeGreaterThanOrEqual(8);
    expect(at(s, 1, 1, 2)?.key).toBe('gt_1169');
    expect(s.ports.filter((p) => p.kind === 'maintenance')).toHaveLength(1);
  });

  it.each([['fluid:hydrogen'], ['fluid:steam']])('an oil cracker takes hydrocarbon and cracking fluid on different columns (%s)', (gas) => {
    const s = structureFor(mb(1160, { inputs: ['fluid:oil', gas], outputs: ['fluid:cracked'] }))!;
    expect(s.size).toEqual([5, 3, 3]);
    expect(countKey(s, 'coil_cupronickel')).toBe(16);
    const inn = s.ports.filter((p) => p.kind === 'in');
    expect(inn.find((p) => p.keys[0] === gas)?.rel[0]).toBe(2);
    expect(inn.find((p) => p.keys[0] === 'fluid:oil')?.rel[0]).toBe(0);
    expect(s.ports.find((p) => p.kind === 'out')?.rel[0]).toBe(4);
  });

  it('unknown multiblocks and ones above HV have no structure', () => {
    expect(structureFor(mb(9999))).toBeUndefined();
    expect(structureFor(mb(1126, { tier: 'EV', outputs: ['fluid:a'] }))).toBeUndefined();
  });

  it.each([
    ['tower', () => tower(FLUIDS, { outputs: [...FLUIDS, 'item:i'], inputs: ['fluid:x', 'fluid:y', 'item:z'] })],
    ['lcr', () => structureFor(mb(1169, { inputs: ['fluid:a', 'fluid:b', 'item:c'], outputs: ['fluid:d', 'item:e'] }))!],
    ['cracker', () => structureFor(mb(1160, { inputs: ['fluid:oil', 'fluid:steam'], outputs: ['fluid:o'] }))!],
  ])('%s: no shared cells, ports face out of the box', (_n, make) => {
    const s = make();
    const [w, , d] = s.size;
    const cells = [...s.blocks.map((b) => b.rel), ...s.ports.map((p) => p.rel)].map((r) => r.join(','));
    expect(new Set(cells).size).toBe(cells.length);
    for (const p of s.ports) {
      const [x, , z] = p.rel;
      const out = p.facing === 3 ? z === d - 1 : p.facing === 2 ? z === 0 : p.facing === 4 ? x === 0 : p.facing === 5 ? x === w - 1 : false;
      expect(out).toBe(true);
    }
  });
});
