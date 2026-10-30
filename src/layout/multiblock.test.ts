import { buildable, ebfHeat, structureFor, type Structure } from './multiblock';
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

  // GT's casing minimums (checkCasingMin in checkMachine): MTEOilCracker 18, MTELargeChemicalReactor 8,
  // MTEDistillationTower 7 * (mHeight + 1) - 5, where mHeight + 1 is the tower's height.
  it.each([['fluid:hydrogen'], ['fluid:steam']])('an oil cracker keeps at least 18 casings, one hatch per fluid (%s)', (gas) => {
    const s = structureFor(mb(1160, { inputs: ['fluid:oil', gas], outputs: ['fluid:cracked'] }))!;
    expect(countKey(s, 'casing_clean_stainless')).toBeGreaterThanOrEqual(18);
    expect(s.ports.filter((p) => p.kind === 'in' && p.rel[0] === 0)).toHaveLength(1);
    expect(s.ports.filter((p) => p.kind === 'out')).toHaveLength(1);
    expect(s.ports.filter((p) => p.kind === 'out' && !p.keys.length)).toHaveLength(0);
  });

  it('a large chemical reactor with every hatch spot used keeps at least 8 casings, and its energy hatch', () => {
    const many = (p: string, n: number) => Array.from({ length: n }, (_, i) => `fluid:${p}${i}`);
    const s = structureFor(mb(1169, { inputs: [...many('i', 8), 'item:x'], outputs: [...many('o', 6), 'item:y'] }))!;
    expect(countKey(s, 'casing_chemically_inert')).toBeGreaterThanOrEqual(8);
    expect(s.ports.filter((p) => p.kind === 'energy')).toHaveLength(1);
    expect(s.notes.length).toBeGreaterThan(0);
  });

  it.each([1, 2, 5, 11])('a %i-output tower with every bottom-layer port used keeps 7h - 5 casings', (n) => {
    const outs = FLUIDS.concat(['fluid:f', 'fluid:g', 'fluid:h', 'fluid:i', 'fluid:j', 'fluid:k']).slice(0, n);
    const s = tower(outs, { inputs: ['fluid:x', 'fluid:y', 'fluid:z', 'item:a'], outputs: [...outs, 'item:b'] });
    const h = s.size[1];
    expect(countKey(s, 'casing_clean_stainless')).toBeGreaterThanOrEqual(7 * h - 5);
  });

  it('a large chemical reactor with two fluid outputs locks each output hatch to its fluid', () => {
    const s = structureFor(mb(1169, { inputs: ['fluid:a'], outputs: ['fluid:b', 'fluid:c', 'item:d'] }))!;
    const outs = s.ports.filter((p) => p.kind === 'out');
    expect(outs.filter((p) => p.key === 'hatch_output_lv').map((p) => [p.keys, p.locked])).toEqual([[['fluid:b'], true], [['fluid:c'], true]]);
    expect(outs.find((p) => p.key === 'bus_output_lv')?.locked).toBeUndefined();
    expect(s.ports.filter((p) => p.kind === 'in').every((p) => !p.locked)).toBe(true);
  });

  it('one fluid output, or a distillation tower (one hatch per layer), needs no lock', () => {
    const one = structureFor(mb(1169, { inputs: ['fluid:a'], outputs: ['fluid:b'] }))!;
    expect(one.ports.some((p) => p.locked)).toBe(false);
    expect(tower(FLUIDS).ports.some((p) => p.locked)).toBe(false);
    const cracker = structureFor(mb(1160, { inputs: ['fluid:oil', 'fluid:steam'], outputs: ['fluid:o'] }))!;
    expect(cracker.ports.some((p) => p.locked)).toBe(false);
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

describe('electric blast furnace and vacuum freezer', () => {
  const ebf = (heat: number, over: Partial<PlanMachine> = {}) =>
    structureFor(mb(1000, { inputs: ['item:dust', 'fluid:oxygen'], outputs: ['item:ingot'], heat, ...over }));

  it('an EBF is 3x3x4: heat proof bottom with the controller, two coil rings, a muffler facing up on top', () => {
    const s = ebf(1000, { tier: 'MV' })!;
    expect(s.size).toEqual([3, 4, 3]);
    expect(at(s, 1, 0, 2)?.key).toBe('gt_1000');
    for (const y of [1, 2]) {
      expect(at(s, 1, y, 1)).toBeUndefined();
      expect(s.blocks.filter((b) => b.rel[1] === y && b.key === 'coil_cupronickel')).toHaveLength(8);
    }
    expect(s.blocks.filter((b) => b.rel[1] === 3 && b.key === 'casing_heat_proof')).toHaveLength(8);
    expect(s.ports.find((p) => p.kind === 'muffler')).toMatchObject({ rel: [1, 3, 1], facing: 1, key: 'hatch_muffler_lv', keys: [] });
    expect(s.ports.filter((p) => p.kind !== 'muffler').every((p) => p.rel[1] === 0)).toBe(true);
  });

  it("an EBF's bottom layer: energy front right, maintenance back, buses at the sides, fluids front left", () => {
    const s = ebf(1000, { tier: 'MV', outputs: ['item:ingot', 'fluid:co2'] })!;
    const port = (kind: string, key?: string) => s.ports.find((p) => p.kind === kind && (!key || p.key === key));
    expect(port('energy')).toMatchObject({ rel: [2, 0, 2], facing: 3, key: 'hatch_energy_mv' });
    expect(port('maintenance')).toMatchObject({ rel: [1, 0, 0], facing: 2 });
    expect(port('in', 'bus_input_lv')).toMatchObject({ rel: [0, 0, 1], facing: 4, keys: ['item:dust'] });
    expect(port('out', 'bus_output_lv')).toMatchObject({ rel: [2, 0, 1], facing: 5, keys: ['item:ingot'] });
    expect(port('in', 'hatch_input_lv')).toMatchObject({ rel: [0, 0, 2], facing: 3, keys: ['fluid:oxygen'] });
    expect(port('out', 'hatch_output_lv')).toMatchObject({ rel: [0, 0, 0], facing: 4, keys: ['fluid:co2'] });
  });

  it('the coil is the cheapest that reaches the recipe heat with the energy hatch bonus', () => {
    const coil = (heat: number, tier: string) => ebf(heat, { tier })?.blocks.find((b) => b.rel[1] === 1)?.key;
    expect(coil(1801, 'MV')).toBe('coil_cupronickel');
    expect(coil(1802, 'MV')).toBe('coil_kanthal');
    expect(coil(1901, 'HV')).toBe('coil_cupronickel');
    expect(coil(2801, 'HV')).toBe('coil_kanthal');
    expect(coil(2802, 'HV')).toBe('coil_nichrome');
    expect(coil(1750, 'LV')).toBe('coil_kanthal'); // LV hatch: 1801 - 100
  });

  it('an EBF hotter than Nichrome can reach has no structure', () => {
    expect(ebf(3701, { tier: 'HV' })).toBeDefined();
    expect(ebf(3702, { tier: 'HV' })).toBeUndefined();
    expect(buildable(1000, 'HV', 3702)).toBe(false);
    expect(buildable(1000, 'HV')).toBe(true);
    expect(ebfHeat(3601, 'HV')).toBe(3701);
  });

  it('a vacuum freezer is 3x3x3 frost proof, hollow, controller at the middle front', () => {
    const s = structureFor(mb(1002, { tier: 'MV', inputs: ['item:hot'], outputs: ['item:cold'] }))!;
    expect(s.size).toEqual([3, 3, 3]);
    expect(at(s, 1, 1, 1)).toBeUndefined();
    expect(at(s, 1, 1, 2)?.key).toBe('gt_1002');
    expect(s.ports.find((p) => p.kind === 'maintenance')).toMatchObject({ rel: [1, 0, 0], facing: 2 });
    expect(s.ports.find((p) => p.kind === 'energy')).toMatchObject({ rel: [0, 1, 2], facing: 3 });
    expect(countKey(s, 'casing_frost_proof') + s.ports.length + 1).toBe(26);
  });

  it('a vacuum freezer with too many hatches keeps 16 casings and its energy hatch, and says so', () => {
    const fluids = Array.from({ length: 10 }, (_, i) => `fluid:f${i}`);
    const s = structureFor(mb(1002, { tier: 'MV', inputs: fluids, outputs: ['item:cold'] }))!;
    expect(countKey(s, 'casing_frost_proof')).toBe(16);
    expect(s.ports.some((p) => p.kind === 'energy')).toBe(true);
    expect(s.notes.length).toBeGreaterThan(0);
  });
});
