import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock, Vec3 } from '../model/types';
import { checkLine } from './check';
import { cableLoss } from './loss';
import { VOLTAGE, cableFor } from './power';
import {
  assemble,
  conduitBlocks,
  countTransformers,
  machineUnits,
  markerUnits,
  planNets,
  powerNets,
  routeRegion,
  transformersFor,
  TIERS,
  unitBlock,
  type Net,
  type Placed,
  type Region,
  type Unit,
} from './region';
import { arrangeRows } from './tidyRows';
import { TIDY_BOUNDS, tidySlice, type TidySlice } from './tidySlice';
import type { GeneratedLine, LinePlan, PlanMachine, PowerTier } from './types';

export const FLOOR_NOTE = 'The floor pipes sit one block below the machines: dig one layer for them';
const FRONT_NOTE = 'Place every machine with its front (the face with its picture) against the machine facing it, then wrench its output to the side shown in the 3D view. There is no walkway: GT machines open from any face, so reach them from outside.';
export const UNTIDY_NOTE = "Couldn't keep this line tidy, so some pipes take detours";
export const DENSE_NOTE = 'This line has many pipes per machine, so some pipes turn between machines and the line is a block or two bigger than usual';

/** Row arrangements tried per line, best first. */
const ARRANGEMENTS_TRIED = 8;
const CORE_WIDEN_TRIES = 6;
/** A weak push away from machine faces in the core, for fewer detours. */
const LOW_AVOID = 4;
const BEND_PENALTY = 2;
/** EU/t of cable loss that counts as a real difference between two layouts (half an MV generator). */
const LOSS_STEP = 64;

/** Lexicographic: the first differing entry decides. */
const lessThan = (a: number[], b: number[]) => {
  const i = a.findIndex((v, k) => v !== b[k]);
  return i >= 0 && a[i] < b[i];
};

const shift = (b: PlacedBlock, dx: number): PlacedBlock => ({ ...b, pos: [b.pos[0] + dx, b.pos[1], b.pos[2]] });

/**
 * A line in the tidy cross-section: identical slices (see `tidySlice`) either side of a core, or for a straight line
 * one long slice with the core at its end. The core's one-off machines, markers and step-down transformers are routed
 * with the slices' through-runs as lanes. Tries several row arrangements and keeps the least lossy (in half-generator
 * steps), then narrowest, then shortest, then smallest line that passes the checker; undefined when none does.
 */
export function buildTidy(plan: LinePlan, name: string, warnings: string[], why: string[] = []): Build | undefined {
  // A straight line is one long slice of every kind with two or more machines, its one-offs in the core at one end.
  const straight = plan.style === 'straight';
  let rows = straight ? (plan.straight ?? []).filter((m) => m.count >= 2 && !m.multiblock) : plan.slice ?? [];
  let oneOffs = straight ? (plan.straight ?? []).filter((m) => !rows.includes(m)) : plan.core;
  if (!rows.length) return undefined;
  const copies = straight ? { left: 0, right: 1 } : { left: plan.sliceCount - Math.ceil(plan.sliceCount / 2), right: Math.ceil(plan.sliceCount / 2) };
  ({ rows, oneOffs } = powerEachRegion(plan, rows, oneOffs, copies.left + copies.right));
  const source = plan.power.source.tier;
  const sliceMachines = machineUnits(rows);
  const coreMachines = machineUnits(oneOffs);
  const everyMachine = [...sliceMachines.flatMap((u) => Array.from({ length: copies.left + copies.right }, () => u)), ...coreMachines];
  const markers = markerUnits(plan.markers);
  const netWarnings: string[] = [];
  const nets = [...planNets(plan, netWarnings), ...powerNets(plan, everyMachine, countTransformers(transformersFor(coreMachines, source)), netWarnings)];

  let best: { build: Build; score: number[]; relaxed: boolean; slice: TidySlice } | undefined;
  // The shortest arrangements, and those that keep every row to one kind (every run straight through).
  // Machines with more inputs or outputs than their two runs need side faces: they get gaps beside them.
  const sideFaces = new Map(rows.map((m) => {
    const ins = nets.filter((n) => n.kind !== 'cable' && n.consumers.has(m.nodeId)).length;
    const outs = m.generator ? 0 : nets.filter((n) => n.kind !== 'cable' && n.producers.has(m.nodeId)).length;
    return [m.nodeId, Math.min(2, Math.max(0, ins - 1) + Math.max(0, outs - 1))];
  }));
  // Two high first; when machines need side faces, also one high (the upper level then left for pipes to rise into).
  const needsSides = [...sideFaces.values()].some((n) => n > 0);
  const arrangements = [
    ...arrangeRows(rows, undefined, false, [0, 1, 2, 3], sideFaces).slice(0, ARRANGEMENTS_TRIED),
    ...arrangeRows(rows, undefined, true, [0, 1, 2, 3], sideFaces).slice(0, ARRANGEMENTS_TRIED),
    ...(needsSides ? arrangeRows(rows, undefined, true, [0, 2], sideFaces).slice(0, ARRANGEMENTS_TRIED) : []),
  ];
  const genRole = [...rows, ...oneOffs].find((m) => m.generator)?.nodeId;
  // The core only sees where the slices' through-runs enter it: one that can't be routed for a set of entries can't for
  // any slice with the same entries.
  const coreFails = new Set<string>();
  const entries = (slice: TidySlice) => [...slice.throughRuns]
    .map(([id, runs]) => `${id}:${runs.map((r) => `${r[0][1]},${r[0][2]}`).sort().join(';')}`).sort().join('|');
  // Strict first (pipes leave their runs only in service and gap columns); relaxed only if nothing strict fits.
  for (const relaxed of [false, true]) {
    if (best) break;
    for (const arr of arrangements) {
      for (const serviceWidth of [1, 2]) {
        for (const powerFirst of [true, false]) {
          const slice = tidySlice(arr, nets, plan, { serviceWidth, straight, powerFirst, copies: copies.left + copies.right, relaxed });
          if ('fail' in slice) {
            why.push(`slice: ${slice.fail}`);
            continue;
          }
          if (coreFails.has(entries(slice))) continue;
          // A quick core to compare slices by; the winner's core is made compact afterwards.
          const build = withCore(plan, name, slice, copies, nets, coreMachines, everyMachine, markers, [...warnings, ...netWarnings], true, why);
          if (!build) coreFails.add(entries(slice));
          if (!build) continue;
          const problems = checkLine(build, plan);
          if (problems.length) {
            why.push(`check: ${problems[0]}`);
            continue;
          }
          const span = (a: number) => Math.max(...build.blocks.map((b) => b.pos[a])) - Math.min(...build.blocks.map((b) => b.pos[a])) + 1;
          // Fewest generators; then EU lost in cables (in half-generator steps); then the shortest line, the narrowest,
          // the fewest blocks.
          const generators = build.blocks.filter((b) => b.role === genRole).length;
          const score = [generators, Math.ceil(cableLoss(build, plan).total / LOSS_STEP), span(0), span(2), build.blocks.length];
          if (!best || lessThan(score, best.score)) best = { build, score, relaxed, slice };
        }
      }
    }
  }
  if (!best) return undefined;
  const compact = withCore(plan, name, best.slice, copies, nets, coreMachines, everyMachine, markers, [...warnings, ...netWarnings], false);
  if (compact && !checkLine(compact, plan).length) best.build = compact;
  best.build.notes = (best.build.notes ?? []).map((n) => (n.startsWith('Place every machine with its front') ? FRONT_NOTE : n));
  if (best.relaxed) best.build.notes.push(DENSE_NOTE);
  // Say so when the line has more generators than the Calculator counted (each region powers itself).
  const gen = [...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])].find((m) => m.generator);
  if (gen) {
    const planned = [...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])]
      .filter((m) => m.generator)
      .reduce((s, m) => s + m.count * ((plan.slice ?? []).includes(m) ? plan.sliceCount : 1), 0);
    const built = best.build.blocks.filter((b) => b.role === gen.nodeId).length;
    if (built > planned) {
      best.build.notes = [...(best.build.notes ?? []),
        `Each slice and the core have their own generators so power never travels far: ${built} in all (the Calculator counted ${planned}). Idle generators burn no fuel`];
    }
  }
  return best.build;
}

/** Machine spots in a core column: (y, z) of the lower and upper rows of both columns. */
const ROW_SPOTS: readonly [number, number][] = [[0, 0], [0, 1], [2, 0], [2, 1]];
/** A core machine's front faces the other column (fronts take nothing in, and stay clear). */
const facingInward = (u: Placed): Placed =>
  u.pm && !u.pm.generator && !u.pm.multiblock && !u.transformer ? { ...u, mainFacing: u.pos[2] <= 0 ? 3 : 2 } : u;
const inBounds = (c: Vec3) => c[1] >= TIDY_BOUNDS.yMin && c[1] <= TIDY_BOUNDS.yMax && c[2] >= TIDY_BOUNDS.zMin && c[2] <= TIDY_BOUNDS.zMax;

/**
 * Core machines every other column, each at whichever of its column's four row spots leaves it the most free faces
 * (through-runs pass the core too); a step-down transformer goes right beside a machine of its lower voltage (direct
 * power), else in any free spot.
 */
function placeTidyCore(units: Unit[], start: number, length: number, side: (u: Unit) => -1 | 1, taken: Set<string>, step: 1 | 2): Placed[] | undefined {
  const placed: Placed[] = [];
  const free = (c: Vec3) => !taken.has(posKey(c)) && inBounds(c);
  const faces = (p: Vec3) => DIRS.filter((d) => free(addVec(p, d))).length;
  const put = (u: Unit, pos: Vec3) => {
    placed.push({ ...u, pos });
    taken.add(posKey(pos));
  };
  const perSide = (z: number) => placed.filter((p) => p.pos[2] === z).length;
  for (const [i, u] of units.filter((x) => !x.transformer).entries()) {
    const x = start + (step === 2 ? 1 : 0) + step * i;
    const spots = ROW_SPOTS.map(([y, z]): Vec3 => [x, y, z]).filter(free);
    if (!spots.length) return undefined;
    // Most free faces; then the side with fewer core machines (so one side doesn't crowd); then low; then its side.
    const own = side(u) < 0 ? 0 : 1;
    spots.sort((a, b) => faces(b) - faces(a) || perSide(a[2]) - perSide(b[2]) || a[1] - b[1] || (a[2] === own ? -1 : 0) - (b[2] === own ? -1 : 0));
    put(u, spots[0]);
  }
  // A transformer gives its lower voltage on every face but its input, so it may touch only machines of that voltage.
  const safeFor = (t: Unit) => (c: Vec3) => free(c) && c[0] >= start && c[0] < start + length && DIRS.every((d) => {
    const m = placed.find((p) => posKey(p.pos) === posKey(addVec(c, d)));
    return !m || !m.tier || m.marker || m.pm?.generator || m.tier === t.transformer!.to;
  });
  for (const t of units.filter((x) => x.transformer)) {
    const ok = safeFor(t);
    const near = placed
      .filter((m) => !m.transformer && m.tier === t.transformer!.to)
      .flatMap((m) => [1, -1].map((dx): Vec3 => [m.pos[0] + dx, m.pos[1], m.pos[2]]))
      .find(ok);
    const any = Array.from({ length }, (_, k) => start + k).flatMap((x) => ROW_SPOTS.map(([y, z]): Vec3 => [x, y, z])).find(ok);
    const pos = near ?? any;
    if (!pos) return undefined;
    put(t, pos);
  }
  return placed;
}

/** Generators a region needs for what its machines use on average, with a margin for cable loss. */
const GENERATOR_MARGIN = 1.1;

/**
 * Every slice and the core power themselves (no long feed between them): the generators go where the power is used,
 * as many in each slice as its machines need and the rest (plus any added for cable loss) in the core. Slices without
 * generators in the plan take power from the core through a feed.
 */
function powerEachRegion(plan: LinePlan, rows: PlanMachine[], oneOffs: PlanMachine[], copies: number): { rows: PlanMachine[]; oneOffs: PlanMachine[] } {
  const allGens = [...rows, ...oneOffs].filter((m) => m.generator);
  if (new Set(allGens.map((g) => g.tier)).size > 1) return powerEachVoltage(rows, oneOffs, copies, allGens);
  const gen = [...rows, ...oneOffs].find((m) => m.generator);
  if (!gen || plan.power.source.kind !== 'generators' || !gen.eut) return { rows, oneOffs };
  const uses = (ms: PlanMachine[], per: number) => ms.filter((m) => !m.generator && !m.multiblock).reduce((s, m) => s + (m.avgEut ?? m.eut * m.count * per) / per, 0);
  const need = (eu: number) => (eu > 0 ? Math.ceil((eu * GENERATOR_MARGIN) / gen.eut - 1e-9) : 0);
  const planned = [...rows, ...oneOffs].filter((m) => m.generator).reduce((s, m) => s + m.count * (rows.includes(m) ? copies : 1), 0);
  const inRows = rows.some((m) => m.generator);
  // A transformer gives 4 A of the lower voltage: one generator (through one transformer) per 4 machines a step down.
  const stepDown = rows.some((m) => !m.generator && m.tier && TIERS.indexOf(m.tier as PowerTier) < TIERS.indexOf(gen.tier as PowerTier));
  const machinesPerSlice = rows.filter((m) => !m.generator && !m.multiblock).reduce((s, m) => s + m.count, 0);
  const perSlice = inRows ? Math.max(need(uses(rows, copies)), stepDown ? Math.ceil(machinesPerSlice / 4) : 0) : 0;
  const coreOwn = need(uses(oneOffs, 1) + (inRows ? 0 : uses(rows, copies) * copies));
  // Generators added to the plan for cable loss stay in the core.
  const core = Math.max(coreOwn, planned - perSlice * copies);
  const withGen = (ms: PlanMachine[], count: number) => [...ms.filter((m) => !m.generator), ...(count > 0 ? [{ ...gen, count }] : [])];
  return { rows: withGen(rows, perSlice), oneOffs: withGen(oneOffs, core) };
}

/**
 * Generators matching each voltage: each region gets, for every voltage its machines use, generators of that voltage
 * (or the next one up, through transformers) covering what they use on average.
 */
function powerEachVoltage(rows: PlanMachine[], oneOffs: PlanMachine[], copies: number, gens: PlanMachine[]) {
  const genFor = (tier: string) => {
    const want = TIER_ORDER.indexOf(tier);
    return [...gens].sort((a, b) => TIER_ORDER.indexOf(a.tier!) - TIER_ORDER.indexOf(b.tier!)).find((g) => TIER_ORDER.indexOf(g.tier!) >= want) ?? gens[gens.length - 1];
  };
  const region = (ms: PlanMachine[], per: number): PlanMachine[] => {
    const count = new Map<PlanMachine, number>();
    const machinesOf = new Map<PlanMachine, number>();
    for (const m of ms.filter((x) => !x.generator && !x.multiblock && x.tier)) {
      const tier = m.tier === 'ULV' ? 'LV' : m.tier!;
      const g = genFor(tier);
      const eu = (m.avgEut ?? m.eut * m.count * per) / per;
      count.set(g, (count.get(g) ?? 0) + eu);
      if (TIER_ORDER.indexOf(g.tier!) > TIER_ORDER.indexOf(tier)) machinesOf.set(g, (machinesOf.get(g) ?? 0) + m.count);
    }
    const out: PlanMachine[] = [];
    for (const [g, eu] of count) {
      const need = Math.max(Math.ceil((eu * GENERATOR_MARGIN) / g.eut - 1e-9), Math.ceil((machinesOf.get(g) ?? 0) / 4));
      if (need > 0) out.push({ ...g, count: need });
    }
    return [...ms.filter((m) => !m.generator), ...out];
  };
  return { rows: region(rows, copies), oneOffs: region(oneOffs, 1) };
}
const TIER_ORDER = ['LV', 'MV', 'HV'];

/** The core for a tidy slice, and the whole line assembled around it. */
function withCore(
  plan: LinePlan, name: string, slice: TidySlice, copies: { left: number; right: number }, nets: Net[], coreMachines: Unit[], everyMachine: Unit[],
  markers: Unit[], warnings: string[], quick: boolean, why: string[] = [],
): Build | undefined {
  const source = plan.power.source.tier;
  const feed = slice.nets.find((n) => n.kind === 'cable' && slice.throughRuns.has(n.id));
  // The core steps the source down to the feed (if the slices run below it) and to its own machines' voltages.
  const ownGen = new Set(coreMachines.filter((u) => u.pm?.generator).map((u) => u.tier));
  const needsStep = (u: Unit) => !u.pm?.generator && !ownGen.has(u.tier);
  const steps = feed && feed.tier !== source
    ? [...transformersFor(everyMachine, source).filter((t) => t.transformer!.from === source), ...transformersFor(coreMachines.filter(needsStep), source).filter((t) => t.transformer!.from !== source)]
    : ownGen.size > 1 ? transformersFor(coreMachines.filter(needsStep), source) : transformersFor(coreMachines, source);
  const coreUnits = [...coreMachines, ...steps];
  const markerColumns = Math.ceil(markers.length / 4);
  const laneIds = new Set(slice.throughRuns.keys());
  const local = nets.map((n) => (n.kind === 'cable' && !n.source && !laneIds.has(n.id) ? { ...n, id: `${n.id}:core` } : n));
  // A power network that stays in the core carries only the core's own generators: size its cable for those.
  const genEutAt = (tier?: string) => coreUnits.filter((u) => u.pm?.generator && u.tier === tier).reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
  const sized = (n: Net): Net =>
    n.kind === 'cable' && !laneIds.has(n.id) && plan.power.source.kind === 'generators' && genEutAt(n.tier) > 0
      ? { ...n, conduit: cableFor(n.tier!, Math.max(1, genEutAt(n.tier) / VOLTAGE[n.tier!])).key }
      : n;
  const coreNets = local.map((n) => sized(slice.nets.find((s) => s.id === n.id) ?? n));
  // A core machine sits on the side with more of the through-runs it uses.
  const coreSide = (u: Unit): -1 | 1 => {
    const uses = (z: number) => [...slice.throughRuns].filter(([id, runs]) => {
      const n = coreNets.find((x) => x.id === id);
      return n && (n.producers.has(u.role) || n.consumers.has(u.role)) && runs.some((r) => (r[0][2] <= 0 ? -1 : 1) === z);
    }).length;
    return uses(1) > uses(-1) ? 1 : -1;
  };

  const L = slice.length;
  // Machines packed side by side or every other column, routed keeping clear of machine faces or not; for each, the
  // shortest core that routes. The shortest of those wins, then the one with the fewest pipe blocks.
  const machineCount = Math.max(coreUnits.filter((u) => !u.transformer).length, 1);
  let best: { build: Build; score: number[] } | undefined;
  let lastWhy = '';
  const shapes = quick
    ? [{ step: 2 as const, avoid: undefined }]
    : ([1, 2] as const).flatMap((step) => [undefined, LOW_AVOID].map((avoid) => ({ step, avoid })));
  for (const { step, avoid } of shapes) {
  for (let extra = 0; extra < CORE_WIDEN_TRIES; extra++) {
    const C = markerColumns + step * machineCount + (step === 2 ? 2 : 1) + extra;
    if (best && C > best.score[0]) break;
    const coreMin = -C;
    // Through-runs are fixed only where they meet the slices (both core ends, or just the slice end of a straight
    // line); the core joins them, straight where it can and around the core machines where it must.
    const ends = (r: Vec3[]): Vec3[][] => [...(copies.left ? [[[coreMin, r[0][1], r[0][2]] as Vec3]] : []), [[-1, r[0][1], r[0][2]]]];
    const lanes = new Map([...slice.throughRuns].map(([id, runs]) => [id, runs.flatMap(ends)]));
    const keepClear = new Set<string>();
    const laneYs = [...lanes.values()].flat(2).map((c) => c[1]);
    const laneZs = [...lanes.values()].flat(2).map((c) => c[2]);
    const taken = new Set([...keepClear, ...[...lanes.values()].flat(2).map(posKey)]);
    // A marker sits right beside the through-run it fills or empties (no pipe needed), else in the end column.
    const corePlaced: Placed[] = [];
    const roomy = (c: Vec3) => !taken.has(posKey(c)) && c[0] >= coreMin && c[0] < 0 && inBounds(c);
    for (const [i, u] of markers.entries()) {
      const net = coreNets.find((n) => n.producers.has(u.role) || n.consumers.has(u.role));
      const beside = (lanes.get(net?.id ?? '') ?? []).flat()
        .flatMap((c) => DIRS.map((d) => addVec(c, d)))
        .filter(roomy)
        .sort((a, b) => a[0] - b[0])[0];
      const end = Array.from({ length: 8 }, (_, k): Vec3 => [coreMin + Math.floor(k / 4), ROW_SPOTS[k % 4][0], ROW_SPOTS[k % 4][1]]).find(roomy);
      const pos = beside ?? end ?? [coreMin, 0, i % 2];
      corePlaced.push({ ...u, pos });
      taken.add(posKey(pos));
    }
    const core = placeTidyCore(coreUnits, coreMin + markerColumns, C - markerColumns, coreSide, taken, step);
    if (!core) {
      lastWhy = 'core: no room to place the core machines';
      continue;
    }
    corePlaced.push(...core.map(facingInward));
    // Nothing goes in front of a core machine.
    for (const u of corePlaced) if (u.mainFacing !== undefined) keepClear.add(posKey(addVec(u.pos, DIRS[u.mainFacing])));
    const region: Region = {
      // Within the tidy cross-section, or as far out as the slices' runs come in.
      name: 'core', units: corePlaced,
      min: [coreMin, Math.min(TIDY_BOUNDS.yMin, ...laneYs), Math.min(TIDY_BOUNDS.zMin, ...laneZs)],
      max: [-1, Math.max(TIDY_BOUNDS.yMax, ...laneYs), Math.max(TIDY_BOUNDS.zMax, ...laneZs)],
      lanes, keepClear, bendPenalty: BEND_PENALTY, walkway: false, ...(avoid !== undefined ? { avoidPenalty: avoid } : {}),
    };
    const routed = routeRegion(region, coreNets, plan, true);
    if ('fail' in routed) {
      lastWhy = `core: ${routed.fail}`;
      continue;
    }

    const { left, right } = copies;
    const leftStart = coreMin - left * L;
    const laneCells = new Set([...lanes.values()].flat(2).map(posKey));
    const blocks = [
      ...Array.from({ length: left }, (_, k) => slice.blocks.map((b) => shift(b, leftStart + k * L))).flat(),
      ...corePlaced.map(unitBlock),
      ...conduitBlocks(routed, coreNets, laneIds, laneCells),
      ...Array.from({ length: right }, (_, k) => slice.blocks.map((b) => shift(b, k * L))).flat(),
    ];
    const sliceCovers = slice.routed.covers;
    const covers = [
      ...Array.from({ length: left }, (_, k) => sliceCovers.map((c) => ({ ...c, pos: [c.pos[0] + leftStart + k * L, c.pos[1], c.pos[2]] as Vec3 }))).flat(),
      ...routed.covers,
      ...Array.from({ length: right }, (_, k) => sliceCovers.map((c) => ({ ...c, pos: [c.pos[0] + k * L, c.pos[1], c.pos[2]] as Vec3 }))).flat(),
    ];
    const per = plan.inputsPerSlice;
    const perNet = per && plan.networks.find((n) => n.key === per.key);
    const perMarker = per && plan.markers.find((m) => m.key === per.key);
    const generated: GeneratedLine | undefined = plan.style === 'straight' ? undefined : {
      style: 'modular', sliceLength: L, sliceCount: plan.sliceCount, left, right, leftStart, rightStart: 0, template: slice.blocks,
      serviceFrom: slice.serviceFrom, walkway: false,
      ...(sliceCovers.length ? { templateCovers: sliceCovers } : {}),
      ...(plan.coreServes !== undefined ? { coreServes: plan.coreServes } : {}),
      ...(per && perNet ? { inputsPerSlice: { key: per.key, name: perNet.name, kind: perMarker?.kind === 'fluid' ? 'fluid' : 'item', amount: per.amount } } : {}),
    };
    const sliceNotes = slice.routed.notes.length ? [`In every slice: ${slice.routed.notes.join(' ')}`] : [];
    const floor = blocks.some((b) => b.net && b.pos[1] === -1) ? [FLOOR_NOTE] : [];
    const allNets = [...coreNets, ...slice.nets.filter((n) => !coreNets.some((c) => c.id === n.id))];
    const build = assemble(name, plan, blocks, covers, [...plan.notes, ...floor, ...sliceNotes, ...routed.notes, ...warnings], generated, allNets);
    const score = [C, routed.cells.size];
    if (!best || lessThan(score, best.score)) best = { build, score };
    break;
  }
  }
  if (!best && lastWhy) why.push(lastWhy);
  return best?.build;
}
