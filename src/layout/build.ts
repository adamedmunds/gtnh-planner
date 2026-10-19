import { posKey } from '../model/directions';
import type { Build, PlacedBlock, Vec3 } from '../model/types';
import { checkLine } from './check';
import { cableLoss } from './loss';
import { UNTIDY_NOTE, buildTidy } from './tidy';
import type { GeneratedLine, LinePlan, PlanMachine } from './types';
import {
  type Net,
  type Placed,
  type Region,
  TIERS,
  type Unit,
  assemble,
  conduitBlocks,
  countTransformers,
  machineUnits,
  markerUnits,
  placeCore,
  planNets,
  powerNets,
  routeRegion,
  transformersFor,
  unitBlock,
  withFront,
} from './region';

const WIDEN_TRIES = 6;

/** Layouts tried while adding generators to cover cable loss (each try can move cables and change the loss). */
const MAX_TOP_UPS = 5;

/**
 * A slice cross-section. Compact: machine columns in side-by-side pairs between service columns, lanes right behind
 * the machines, 7 wide. Roomy: a gap column on both sides of every machine column, lanes further
 * out, 11 wide — the fallback when the compact form can't route.
 */
interface Form {
  name: 'compact' | 'narrow' | 'roomy';
  lanes: readonly [number, number][];
  zMax: number;
  yMax: number;
  machineX(column: number): number;
  sliceLength(columns: number, extra: number): number;
  marker(i: number, coreStart: number): Vec3;
}

const COMPACT: Form = {
  name: 'compact',
  // Lanes behind the machines; the rows under and over them stay free so branches can cross the walkway.
  lanes: [
    [0, -2], [0, 2], [1, -2], [1, 2], [-1, -2], [-1, 2], [2, -2], [2, 2],
    [0, -3], [0, 3], [1, -3], [1, 3], [-1, -3], [-1, 3], [2, -3], [2, 3],
  ],
  zMax: 3,
  yMax: 2,
  // Service column, machine pair, service column: every machine has its own service column inside the slice.
  machineX: (c) => 3 * Math.floor(c / 2) + 1 + (c % 2),
  sliceLength: (columns, extra) => 3 * Math.ceil(columns / 2) + 1 + extra,
  marker: (i, coreStart) => [coreStart + 1 + 2 * Math.floor(i / 2), 2, i % 2 ? 3 : -3],
};

/** Roomy's columns (a gap on both sides of every machine) with compact's lanes right behind them: 7 wide. */
const NARROW: Form = { ...COMPACT, name: 'narrow', yMax: 3, machineX: (c) => 2 * c + 1, sliceLength: (columns, extra) => 2 * columns + 1 + extra };

const ROOMY: Form = {
  name: 'roomy',
  lanes: [
    [0, -3], [0, 3], [1, -3], [1, 3], [-1, -3], [-1, 3], [2, -3], [2, 3],
    [0, -4], [0, 4], [1, -4], [1, 4], [-1, -4], [-1, 4], [2, -4], [2, 4],
  ],
  zMax: 5,
  yMax: 3,
  machineX: (c) => 2 * c + 1,
  sliceLength: (columns, extra) => 2 * columns + 1 + extra,
  marker: (i, coreStart) => [coreStart + 1 + 2 * Math.floor(i / 2), 0, i % 2 ? 5 : -5],
};

/** Straight line: machines one high along a walkway, every network routed behind them. */
function buildStraight(plan: LinePlan, name: string, warnings: string[]): Build | undefined {
  const machines = machineUnits(plan.straight ?? []);
  const units: Unit[] = [...machines, ...transformersFor(machines, plan.power.source.tier), ...markerUnits(plan.markers)];
  const nets = [...planNets(plan, warnings), ...powerNets(plan, units, countTransformers(units), warnings)];
  for (let gap = 1; gap <= WIDEN_TRIES; gap++) {
    const step = gap + 1;
    const placed: Placed[] = units.map((u, i) => withFront({ ...u, pos: u.marker ? [i * step, 0, -5] : [i * step, 0, -1] }));
    const region: Region = { name: 'line', units: placed, min: [-1, -1, -5], max: [units.length * step, 3, -1], lanes: new Map() };
    const routed = routeRegion(region, nets, plan, true);
    if ('fail' in routed) continue;
    const blocks = [...placed.map(unitBlock), ...conduitBlocks(routed, nets, new Set(), new Set())];
    return assemble(name, plan, blocks, routed.covers, [...plan.notes, ...routed.notes, ...warnings], undefined, nets);
  }
  return undefined;
}

/** Core + identical slices around a walkway, machines two high in the slices. */
function buildModular(plan: LinePlan, name: string, warnings: string[], form: Form): Build | undefined {
  const source = plan.power.source.tier;
  const sliceMachines = machineUnits(plan.slice ?? []);
  const sliceUnits = [...sliceMachines, ...transformersFor(sliceMachines, source)];
  const coreMachines = machineUnits(plan.core);
  const coreUnits = [...coreMachines, ...transformersFor(coreMachines, source)];
  const markers = markerUnits(plan.markers);
  const allUnits = [...sliceUnits.flatMap((u) => Array.from({ length: plan.sliceCount }, () => u)), ...coreUnits];
  const slice = countTransformers(sliceUnits);
  const core = countTransformers(coreUnits);
  const most = Object.fromEntries(TIERS.map((t) => [t, Math.max(slice[t] ?? 0, core[t] ?? 0)]));
  const nets = [...planNets(plan, warnings), ...powerNets(plan, allUnits, most, warnings)];

  // Lanes: every item/fluid network a slice touches, and the source voltage if a slice uses it.
  const touches = (n: Net) =>
    n.kind === 'cable'
      ? n.source && sliceUnits.some((u) => u.pm?.generator || u.transformer?.from === n.tier || (u.tier === n.tier && !u.pm?.generator))
      : sliceUnits.some((u) => n.producers.has(u.role) || n.consumers.has(u.role));
  const laneNets = nets.filter(touches);
  if (laneNets.length > form.lanes.length) return undefined;
  const laneIds = new Set(laneNets.map((n) => n.id));
  const lanesFor = (x0: number, x1: number) =>
    new Map(laneNets.map((n, i) => [n.id, [Array.from({ length: x1 - x0 + 1 }, (_, k) => [x0 + k, form.lanes[i][0], form.lanes[i][1]] as Vec3)]]));
  // Local voltages (below the source) are separate networks in each slice and in the core.
  const local = (suffix: string) => nets.map((n) => (n.kind === 'cable' && !n.source ? { ...n, id: `${n.id}:${suffix}` } : n));

  // A core machine sits on the side whose lane right behind it carries something it uses, so that lane plugs in.
  const coreSide = (u: Unit): -1 | 1 => {
    const uses = (k: number) => {
      const lane = form.lanes.findIndex(([y, z]) => y === 0 && z === k * 2);
      const n = laneNets[lane];
      return !!n && (n.producers.has(u.role) || n.consumers.has(u.role));
    };
    return uses(1) && !uses(-1) ? 1 : -1;
  };

  const columns = Math.ceil(sliceUnits.length / 4);
  let lastFail = '';
  for (let extra = 0; extra < WIDEN_TRIES; extra++) {
    const L = form.sliceLength(columns, extra);
    const slots: Vec3[] = [];
    for (let c = 0; c < columns; c++) {
      const x = form.machineX(c);
      slots.push([x, 0, -1], [x, 1, -1], [x, 0, 1], [x, 1, 1]);
    }
    const slicePlaced: Placed[] = sliceUnits.map((u, i) => withFront({ ...u, pos: slots[i] }));
    const sliceRegion: Region = { name: 'slice', units: slicePlaced, min: [0, -1, -form.zMax], max: [L - 1, form.yMax, form.zMax], lanes: lanesFor(0, L - 1) };
    const sliceNets = local('slice');
    const sliceRouted = routeRegion(sliceRegion, sliceNets, plan, false);
    if ('fail' in sliceRouted) {
      lastFail = sliceRouted.fail;
      continue;
    }

    const coreCount = Math.max(coreUnits.length, Math.ceil(markers.length / 2), 1);
    const C = 2 * coreCount + 2 + 2 * extra;
    const coreStart = -C;
    const corePlaced: Placed[] = [
      ...placeCore(coreUnits, coreStart, C, coreSide).map(withFront),
      ...markers.map((u, i): Placed => ({ ...u, pos: form.marker(i, coreStart) })),
    ];
    // The core isn't repeated, so it may use the roomy bounds; only its lanes have to line up with the slices'.
    const coreRegion: Region = { name: 'core', units: corePlaced, min: [coreStart, -1, -ROOMY.zMax], max: [-1, ROOMY.yMax, ROOMY.zMax], lanes: lanesFor(coreStart, -1) };
    const coreNets = local('core');
    const coreRouted = routeRegion(coreRegion, coreNets, plan, true);
    if ('fail' in coreRouted) {
      lastFail = coreRouted.fail;
      continue;
    }

    const laneCellsOf = (r: Region) => new Set([...r.lanes.values()].flat(2).map(posKey));
    const template = [...slicePlaced.map(unitBlock), ...conduitBlocks(sliceRouted, sliceNets, laneIds, laneCellsOf(sliceRegion))];
    const right = Math.ceil(plan.sliceCount / 2);
    const left = plan.sliceCount - right;
    const leftStart = coreStart - left * L;
    const shift = (b: PlacedBlock, dx: number): PlacedBlock => ({ ...b, pos: [b.pos[0] + dx, b.pos[1], b.pos[2]] });
    const blocks = [
      ...Array.from({ length: left }, (_, k) => template.map((b) => shift(b, leftStart + k * L))).flat(),
      ...corePlaced.map(unitBlock),
      ...conduitBlocks(coreRouted, coreNets, laneIds, laneCellsOf(coreRegion)),
      ...Array.from({ length: right }, (_, k) => template.map((b) => shift(b, k * L))).flat(),
    ];
    const covers = [
      ...Array.from({ length: left }, (_, k) => sliceRouted.covers.map((c) => ({ ...c, pos: [c.pos[0] + leftStart + k * L, c.pos[1], c.pos[2]] as Vec3 }))).flat(),
      ...coreRouted.covers,
      ...Array.from({ length: right }, (_, k) => sliceRouted.covers.map((c) => ({ ...c, pos: [c.pos[0] + k * L, c.pos[1], c.pos[2]] as Vec3 }))).flat(),
    ];
    const per = plan.inputsPerSlice;
    const perNet = per && plan.networks.find((n) => n.key === per.key);
    const perMarker = per && plan.markers.find((m) => m.key === per.key);
    const generated: GeneratedLine = {
      style: 'modular', sliceLength: L, sliceCount: plan.sliceCount, left, right, leftStart, rightStart: 0, template,
      ...(sliceRouted.covers.length ? { templateCovers: sliceRouted.covers } : {}),
      ...(plan.coreServes !== undefined ? { coreServes: plan.coreServes } : {}),
      ...(per && perNet ? { inputsPerSlice: { key: per.key, name: perNet.name, kind: perMarker?.kind === 'fluid' ? 'fluid' : 'item', amount: per.amount } } : {}),
    };
    const sliceNotes = sliceRouted.notes.length ? [`In every slice: ${sliceRouted.notes.join(' ')}`] : [];
    return assemble(name, plan, blocks, covers, [...plan.notes, ...sliceNotes, ...coreRouted.notes, ...warnings], generated, nets);
  }
  if (lastFail) warnings.push(`(${lastFail})`);
  return undefined;
}

/**
 * Lays the plan out (see `buildOnce`), then makes sure the generators cover what the machines use plus what the cables
 * lose, adding a generator per slice (or to the line) until they do.
 */
export function buildLine(plan: LinePlan, name: string): { build: Build; warnings: string[] } {
  let p = plan;
  let extra = 0;
  for (let attempt = 1; ; attempt++) {
    const out = buildOnce(p, name);
    const lost = Math.round(cableLoss(out.build, p).total);
    const used = Object.values(p.power.demand).reduce((s, x) => s + (x ?? 0), 0);
    const gens = out.build.blocks.filter((b) => [...(p.slice ?? []), ...p.core, ...(p.straight ?? [])].some((m) => m.generator && m.nodeId === b.role));
    const genEut = [...(p.slice ?? []), ...p.core, ...(p.straight ?? [])].find((m) => m.generator)?.eut ?? 0;
    const short = p.power.source.kind === 'generators' && gens.length * genEut < used + lost;
    if (!short || attempt >= MAX_TOP_UPS) {
      const notes = [
        ...(lost > 0
          ? [p.power.source.kind === 'generators'
              ? `Cables lose about ${lost} EU/t${short ? '' : ' (the generators cover it)'}`
              : `Cables lose about ${lost} EU/t — bring in ${Math.ceil(used + lost)} EU/t`]
          : []),
        ...(extra ? [`Added ${extra} extra generator${extra > 1 ? 's' : ''}${p.style === 'modular' ? ' in the core' : ''} to cover cable loss`] : []),
        ...(short ? [`The generators still fall short of what the machines use plus cable loss — add more`] : []),
      ];
      out.build.notes = [...(out.build.notes ?? []), ...notes];
      return out;
    }
    const missing = Math.ceil((used + lost - gens.length * genEut) / genEut - 1e-9);
    p = withExtraGenerators(p, missing);
    extra += missing;
  }
}

/**
 * The plan with `n` more generators: in the core for a modular line (slices must stay identical, and one core place
 * takes exactly as many as needed), else in the straight line.
 */
function withExtraGenerators(plan: LinePlan, n: number): LinePlan {
  const gen = [...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])].find((m) => m.generator)!;
  const add = (ms: PlanMachine[]) =>
    ms.some((m) => m.generator) ? ms.map((m) => (m.generator ? { ...m, count: m.count + n } : m)) : [...ms, { ...gen, count: n }];
  return plan.style === 'modular' ? { ...plan, core: add(plan.core) } : { ...plan, straight: add(plan.straight ?? []) };
}

/**
 * Lays the plan out as blocks: modular (core + identical slices) or a straight line, every network routed and
 * checked. A modular line that won't fit falls back to a straight line, saying so.
 */
function buildOnce(plan: LinePlan, name: string): { build: Build; warnings: string[] } {
  const warnings: string[] = [];
  if (plan.style === 'modular') {
    // Tidy first: every pipe and cable on a fixed straight run.
    const tidy: string[] = [];
    const t = buildTidy(plan, name, tidy);
    if (t && !checkLine(t, plan).length) return { build: t, warnings: tidy };
    // Each form starts clean, so a line that fits never mentions why a tighter form didn't.
    const reasons = new Set<string>();
    for (const form of [COMPACT, NARROW, ROOMY]) {
      const tried: string[] = [];
      const b = buildModular(plan, name, tried, form);
      if (b && !checkLine(b, plan).length) {
        b.notes = [UNTIDY_NOTE, ...(b.notes ?? [])];
        return { build: b, warnings: tried };
      }
      for (const w of tried) if (w.startsWith('(')) reasons.add(w);
    }
    warnings.push("Couldn't fit this line into identical slices, so it's laid out in a straight line instead.", ...reasons);
  }
  const straightPlan: LinePlan = plan.style === 'straight' ? plan : { ...plan, style: 'straight', straight: [...(plan.slice ?? []).map((m) => ({ ...m, count: m.count * plan.sliceCount })), ...plan.core] };
  const b = buildStraight(straightPlan, name, warnings);
  if (!b) throw new Error("Couldn't lay out this line: there isn't room to connect all its pipes and cables.");
  const problems = checkLine(b, straightPlan);
  if (problems.length) b.notes = [...(b.notes ?? []), 'Check these before building:', ...problems];
  return { build: b, warnings };
}
