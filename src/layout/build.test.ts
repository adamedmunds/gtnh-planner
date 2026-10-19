import { emptyChain, type Chain } from '../calc/chain';
import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, line, reference } from '../calculator/testChains';
import { billOfMaterials } from '../model/editing';
import { K } from '../test/oilBerryDb';
import { buildLine } from './build';
import { checkLine } from './check';
import { planLine } from './plan';
import { cableFor, pipeFor } from './power';
import type { LinePlan } from './types';

const plan = async (chain: Chain, style: 'modular' | 'straight' = 'modular'): Promise<LinePlan> => {
  const p = planLine(chain, db, await solveForScreen(chain, db, await createHighsSolver()), style);
  if ('error' in p) throw new Error(p.error);
  return p;
};
const bom = (blocks: Parameters<typeof billOfMaterials>[0]) => Object.fromEntries(billOfMaterials(blocks).map((l) => [l.key, l.count]));

test('oil line (modular) passes the checker', async () => {
  const p = await plan(reference());
  const { build } = buildLine(p, 'Light Fuel line');
  expect(checkLine(build, p)).toEqual([]);
  const b = bom(build.blocks);
  expect(b).toMatchObject({ fluid_extractor_lv: 6, distillery_lv: 18, chemical_reactor_lv: 1, electrolyzer_mv: 1 });
  expect(b.combustion_generator_mv).toBeGreaterThanOrEqual(6); // more when cable loss needs them
  expect(build.generated).toMatchObject({ style: 'modular', sliceCount: 6 });
  expect(build.generated!.left + build.generated!.right).toBe(6);
  expect(build.generated?.walkway).toBe(false); // tidy lines: the machine columns touch
});

test("a line that fits says nothing about the forms it tried first, and no note twice", async () => {
  const p = await plan(reference());
  const { build, warnings } = buildLine(p, 'Light Fuel line');
  expect(build.notes?.filter((n) => n.startsWith('('))).toEqual([]);
  expect(warnings.filter((n) => n.startsWith('('))).toEqual([]);
  expect(new Set(build.notes).size).toBe(build.notes?.length);
});

test('oil line (straight) passes the checker with Calculator counts', async () => {
  const p = await plan(reference(), 'straight');
  const { build } = buildLine(p, 'Light Fuel line');
  expect(checkLine(build, p)).toEqual([]);
  expect(bom(build.blocks)).toMatchObject({ fluid_extractor_lv: 6, distillery_lv: 17, chemical_reactor_lv: 1, electrolyzer_mv: 1 });
  expect(bom(build.blocks).combustion_generator_mv).toBeGreaterThanOrEqual(5); // more when cable loss needs them
  expect(build.generated).toBeUndefined();
});

test("the reactor's second kind of output gets a pump cover and a note", async () => {
  const p = await plan(reference());
  const { build } = buildLine(p, 'Light Fuel line');
  expect(build.covers?.some((c) => c.kind === 'pump')).toBe(true);
  expect(build.notes?.join(' ')).toMatch(/pump cover .*Chemical Reactor/);
});

test('LV machines get power through MV→LV transformers', async () => {
  const p = await plan(reference());
  const { build } = buildLine(p, 'Light Fuel line');
  expect(bom(build.blocks).transformer_mv_lv).toBeGreaterThanOrEqual(1);
  expect(checkLine(build, p)).toEqual([]);
});

test('power from outside adds a power marker', async () => {
  const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, rate: 100 }], externals: [K.oilBerry] };
  const p = await plan(chain, 'straight');
  const { build } = buildLine(p, 'Light Fuel line');
  expect(build.blocks.some((b) => b.key === 'marker_power_in')).toBe(true);
  expect(checkLine(build, p)).toEqual([]);
});

test('markers stand where things come in and go out', async () => {
  const p = await plan(reference());
  const { build } = buildLine(p, 'Light Fuel line');
  const roles = build.blocks.filter((b) => b.key.startsWith('marker_')).map((b) => b.role);
  expect(roles).toEqual(expect.arrayContaining([`in:${K.oilBerry}`, `out:${K.lightFuel}`, `out:${K.sulfur}`]));
});

test('pipe and cable sizes follow the flow', () => {
  expect(pipeFor('fluid', 557).key).toBe('bronze_pipe_small');
  expect(pipeFor('item', 5.57).key).toBe('tin_item_pipe_small');
  expect(cableFor('LV', 3).key).toBe('tin_cable_4x');
  expect(cableFor('MV', 6).key).toBe('annealed_copper_cable_8x'); // lowest loss that carries 6 A of MV in one cable
  expect(cableFor('HV', 4).key).toBe('electrum_cable_2x');
  expect(cableFor('HV', 100).warning).toMatch(/more than/);
});

describe('things a player has to know to build it', () => {
  test('every machine faces the machine across from it and outputs elsewhere', async () => {
    const p = await plan(reference());
    const { build } = buildLine(p, 'Light Fuel line');
    const machines = build.blocks.filter((b) => /fluid_extractor|distillery|chemical_reactor|electrolyzer/.test(b.key));
    for (const m of machines) {
      expect(m.mainFacing).toBe(m.pos[2] <= 0 ? 3 : 2);
      expect(m.facing).not.toBe(m.mainFacing);
    }
    expect(checkLine(build, p)).toEqual([]);
    expect(build.notes?.join(' ')).toMatch(/front .*against the machine facing it/i);
  });

  test('notes say to turn on auto-output and which programmed circuit each machine needs', async () => {
    const p = await plan(reference());
    const notes = buildLine(p, 'Light Fuel line').build.notes!.join(' ');
    expect(notes).toMatch(/auto-output/i);
    expect(notes).toMatch(/Programmed Circuit 2 in every Distillery \(18\)/);
    expect(notes).toMatch(/Programmed Circuit 4 in the Chemical Reactor/);
  });

  test('a shared item pipe gets item filters where it ends', async () => {
    const p = await plan(reference());
    const { build } = buildLine(p, 'Light Fuel line');
    const filters = (build.covers ?? []).filter((c) => c.kind === 'itemFilter');
    expect(filters.map((f) => f.item)).toEqual(expect.arrayContaining([K.hydrogenCell, K.sulfur]));
    expect(build.notes?.join(' ')).toMatch(/Item Filter cover set to Sulfur Dust/);
    expect(checkLine(build, p)).toEqual([]);
  });

  test('power from outside says the voltage and how much', async () => {
    const chain: Chain = { ...emptyChain(), nodes: line(), targets: [{ key: K.lightFuel, rate: 100 }], externals: [K.oilBerry] };
    const p = await plan(chain, 'straight');
    expect(buildLine(p, 'x').build.notes!.join(' ')).toMatch(/Power in: bring MV, [\d,.]+ EU\/t \(\d+ A\)/);
  });

  test('an oversized power line says how many cables it needs', () => {
    expect(cableFor('HV', 100).warning).toMatch(/3 /);
  });
});

describe('compact layouts', () => {
  const box = (blocks: { pos: readonly number[] }[]) => {
    const span = (a: number) => Math.max(...blocks.map((b) => b.pos[a])) - Math.min(...blocks.map((b) => b.pos[a])) + 1;
    return { length: span(0), height: span(1), width: span(2) };
  };

  test('the oil line is compact', async () => {
    const p = await plan(reference());
    const { build } = buildLine(p, 'Light Fuel line');
    const b = box(build.blocks);
    expect(build.generated?.style).toBe('modular');
    expect(b.width).toBeLessThanOrEqual(7); // was 11 with lanes 3–4 blocks out
    expect(b.height).toBeLessThanOrEqual(5);
    const t = build.generated!.template;
    expect(Math.max(...t.map((x) => x.pos[2])) - Math.min(...t.map((x) => x.pos[2])) + 1).toBeLessThanOrEqual(7);
    expect(checkLine(build, p)).toEqual([]);
  });

  test('a slice too busy for any form either builds correctly or says plainly that it cannot', async () => {
    const p = await plan(reference());
    const busy: LinePlan = { ...p, slice: [...(p.slice ?? []), ...p.core], core: [] };
    let build;
    try {
      build = buildLine(busy, 'Light Fuel line').build;
    } catch (e) {
      expect((e as Error).message).toMatch(/^Couldn't lay out this line/);
      return;
    }
    expect(checkLine(build, busy)).toEqual([]);
  });
});

test('every generated conduit names its network, and the build lists them', async () => {
  const p = await plan(reference());
  const { build } = buildLine(p, 'Light Fuel line');
  const ids = new Set((build.networks ?? []).map((n) => n.id));
  const conduits = build.blocks.filter((b) => /pipe|cable/.test(b.key));
  expect(conduits.length).toBeGreaterThan(0);
  for (const c of conduits) expect(ids.has(c.net!)).toBe(true);
  const oil = build.networks!.find((n) => n.name === 'Oil')!;
  expect(oil).toMatchObject({ kind: 'fluid', icon: K.oil });
  expect(build.networks!.some((n) => n.kind === 'power' && n.tier === 'MV')).toBe(true);
});
