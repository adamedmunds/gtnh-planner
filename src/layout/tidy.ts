import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock, Vec3 } from '../model/types';
import { checkLine } from './check';
import { cableLoss } from './loss';
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
  unitBlock,
  withFront,
  type Net,
  type Placed,
  type Region,
  type Unit,
} from './region';
import { arrangeRows } from './tidyRows';
import { TIDY_BOUNDS, tidySlice, type TidySlice } from './tidySlice';
import type { GeneratedLine, LinePlan, PlanMachine } from './types';

export const FLOOR_NOTE = 'The floor pipes sit one block below the walkway: dig one layer for them';
export const UNTIDY_NOTE = "Couldn't keep this line tidy, so some pipes take detours";

/** Row arrangements tried per line, best first. */
const ARRANGEMENTS_TRIED = 8;
const CORE_WIDEN_TRIES = 12;
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
export function buildTidy(plan: LinePlan, name: string, warnings: string[]): Build | undefined {
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

  let best: { build: Build; score: number[] } | undefined;
  for (const arr of arrangeRows(rows).slice(0, ARRANGEMENTS_TRIED)) {
    for (const serviceWidth of [1, 2]) {
      for (const powerFirst of [true, false]) {
        const slice = tidySlice(arr, nets, plan, { serviceWidth, straight, powerFirst });
        if ('fail' in slice) continue;
        const build = withCore(plan, name, slice, copies, nets, coreMachines, everyMachine, markers, [...warnings, ...netWarnings]);
        if (!build || checkLine(build, plan).length) continue;
        const span = (a: number) => Math.max(...build.blocks.map((b) => b.pos[a])) - Math.min(...build.blocks.map((b) => b.pos[a])) + 1;
        // Any width up to 7 is tidy; EU lost (in half-generator steps) comes first, so a wider or longer line wins only
        // when it saves real power; then narrowest, shortest, fewest blocks.
        const score = [Math.ceil(cableLoss(build, plan).total / LOSS_STEP), span(2), slice.length, build.blocks.length];
        if (!best || lessThan(score, best.score)) best = { build, score };
      }
    }
  }
  if (!best) return undefined;
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

const ROW_SPOTS: readonly [number, number][] = [[0, -1], [0, 1], [2, -1], [2, 1]];

/**
 * Core machines every other column, each at whichever of its column's four row spots leaves it the most free faces
 * (through-runs pass the core too); a step-down transformer goes right beside a machine of its lower voltage (direct
 * power), else in any free spot.
 */
function placeTidyCore(units: Unit[], start: number, length: number, side: (u: Unit) => -1 | 1, taken: Set<string>): Placed[] | undefined {
  const placed: Placed[] = [];
  const free = (c: Vec3) => !taken.has(posKey(c)) && !(c[2] === 0 && c[1] <= 1) && c[1] >= TIDY_BOUNDS.yMin && c[1] <= TIDY_BOUNDS.yMax;
  const faces = (p: Vec3) => DIRS.filter((d) => free(addVec(p, d))).length;
  const put = (u: Unit, pos: Vec3) => {
    placed.push({ ...u, pos });
    taken.add(posKey(pos));
  };
  const perSide = (z: number) => placed.filter((p) => p.pos[2] === z).length;
  for (const [i, u] of units.filter((x) => !x.transformer).entries()) {
    const x = start + 1 + 2 * i;
    const spots = ROW_SPOTS.map(([y, z]): Vec3 => [x, y, z]).filter(free);
    if (!spots.length) return undefined;
    // Most free faces; then the side with fewer core machines (so one side doesn't crowd); then low; then its side.
    spots.sort((a, b) => faces(b) - faces(a) || perSide(a[2]) - perSide(b[2]) || a[1] - b[1] || (a[2] === side(u) ? -1 : 0) - (b[2] === side(u) ? -1 : 0));
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
  const gen = [...rows, ...oneOffs].find((m) => m.generator);
  if (!gen || plan.power.source.kind !== 'generators' || !gen.eut) return { rows, oneOffs };
  const uses = (ms: PlanMachine[], per: number) => ms.filter((m) => !m.generator && !m.multiblock).reduce((s, m) => s + (m.avgEut ?? m.eut * m.count * per) / per, 0);
  const need = (eu: number) => (eu > 0 ? Math.ceil((eu * GENERATOR_MARGIN) / gen.eut - 1e-9) : 0);
  const planned = [...rows, ...oneOffs].filter((m) => m.generator).reduce((s, m) => s + m.count * (rows.includes(m) ? copies : 1), 0);
  const inRows = rows.some((m) => m.generator);
  const perSlice = inRows ? need(uses(rows, copies)) : 0;
  const coreOwn = need(uses(oneOffs, 1) + (inRows ? 0 : uses(rows, copies) * copies));
  // Generators added to the plan for cable loss stay in the core.
  const core = Math.max(coreOwn, planned - perSlice * copies);
  const withGen = (ms: PlanMachine[], count: number) => [...ms.filter((m) => !m.generator), ...(count > 0 ? [{ ...gen, count }] : [])];
  return { rows: withGen(rows, perSlice), oneOffs: withGen(oneOffs, core) };
}

/** The core for a tidy slice, and the whole line assembled around it. */
function withCore(
  plan: LinePlan, name: string, slice: TidySlice, copies: { left: number; right: number }, nets: Net[], coreMachines: Unit[], everyMachine: Unit[],
  markers: Unit[], warnings: string[],
): Build | undefined {
  const source = plan.power.source.tier;
  const feed = slice.nets.find((n) => n.kind === 'cable' && slice.throughRuns.has(n.id));
  // The core steps the source down to the feed (if the slices run below it) and to its own machines' voltages.
  const steps = feed && feed.tier !== source
    ? [...transformersFor(everyMachine, source).filter((t) => t.transformer!.from === source), ...transformersFor(coreMachines, source).filter((t) => t.transformer!.from !== source)]
    : transformersFor(coreMachines, source);
  const coreUnits = [...coreMachines, ...steps];
  const markerColumns = Math.ceil(markers.length / 4);
  const laneIds = new Set(slice.throughRuns.keys());
  const local = nets.map((n) => (n.kind === 'cable' && !n.source && !laneIds.has(n.id) ? { ...n, id: `${n.id}:core` } : n));
  const coreNets = local.map((n) => slice.nets.find((s) => s.id === n.id) ?? n);
  // A core machine sits on the side with more of the through-runs it uses.
  const coreSide = (u: Unit): -1 | 1 => {
    const uses = (z: number) => [...slice.throughRuns].filter(([id, runs]) => {
      const n = coreNets.find((x) => x.id === id);
      return n && (n.producers.has(u.role) || n.consumers.has(u.role)) && runs.some((r) => Math.sign(r[0][2]) === z);
    }).length;
    return uses(1) > uses(-1) ? 1 : -1;
  };

  const L = slice.length;
  for (let extra = 0; extra < CORE_WIDEN_TRIES; extra++) {
    const machineCount = Math.max(coreUnits.length, 1);
    const C = markerColumns + 2 * machineCount + 2 + 2 * extra;
    const coreMin = -C;
    // Through-runs are fixed only where they meet the slices (both core ends, or just the slice end of a straight
    // line); the core joins them, straight where it can and around the core machines where it must.
    const ends = (r: Vec3[]): Vec3[][] => [...(copies.left ? [[[coreMin, r[0][1], r[0][2]] as Vec3]] : []), [[-1, r[0][1], r[0][2]]]];
    const lanes = new Map([...slice.throughRuns].map(([id, runs]) => [id, runs.flatMap(ends)]));
    const keepClear = new Set(Array.from({ length: C }, (_, k) => posKey([coreMin + k, -1, 0])));
    const taken = new Set([...keepClear, ...[...lanes.values()].flat(2).map(posKey)]);
    // A marker sits right beside the through-run it fills or empties (no pipe needed), else in the end column.
    const corePlaced: Placed[] = [];
    const roomy = (c: Vec3) => !taken.has(posKey(c)) && !(c[2] === 0 && c[1] <= 1) && c[0] >= coreMin && c[0] < 0 &&
      c[1] >= TIDY_BOUNDS.yMin && c[1] <= TIDY_BOUNDS.yMax && Math.abs(c[2]) <= TIDY_BOUNDS.zMax;
    for (const [i, u] of markers.entries()) {
      const net = coreNets.find((n) => n.producers.has(u.role) || n.consumers.has(u.role));
      const beside = (lanes.get(net?.id ?? '') ?? []).flat()
        .flatMap((c) => DIRS.map((d) => addVec(c, d)))
        .filter(roomy)
        .sort((a, b) => a[0] - b[0])[0];
      const end = Array.from({ length: 8 }, (_, k): Vec3 => [coreMin + Math.floor(k / 4), [0, 0, 2, 2][k % 4], [-1, 1, -1, 1][k % 4]]).find(roomy);
      const pos = beside ?? end ?? [coreMin, 0, i % 2 ? 1 : -1];
      corePlaced.push({ ...u, pos });
      taken.add(posKey(pos));
    }
    const core = placeTidyCore(coreUnits, coreMin + markerColumns, C - markerColumns, coreSide, taken);
    if (!core) continue;
    corePlaced.push(...core.map(withFront));
    // Nothing goes in front of a core machine (upper-row fronts face open air above the walkway).
    for (const u of corePlaced) if (u.mainFacing !== undefined) keepClear.add(posKey(addVec(u.pos, DIRS[u.mainFacing])));
    const region: Region = {
      name: 'core', units: corePlaced, min: [coreMin, TIDY_BOUNDS.yMin, -TIDY_BOUNDS.zMax], max: [-1, TIDY_BOUNDS.yMax, TIDY_BOUNDS.zMax],
      lanes, keepClear, bendPenalty: BEND_PENALTY,
    };
    const routed = routeRegion(region, coreNets, plan, true);
    if ('fail' in routed) continue;

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
      serviceFrom: slice.serviceFrom,
      ...(sliceCovers.length ? { templateCovers: sliceCovers } : {}),
      ...(plan.coreServes !== undefined ? { coreServes: plan.coreServes } : {}),
      ...(per && perNet ? { inputsPerSlice: { key: per.key, name: perNet.name, kind: perMarker?.kind === 'fluid' ? 'fluid' : 'item', amount: per.amount } } : {}),
    };
    const sliceNotes = slice.routed.notes.length ? [`In every slice: ${slice.routed.notes.join(' ')}`] : [];
    const floor = blocks.some((b) => b.net && b.pos[1] === -1) ? [FLOOR_NOTE] : [];
    const allNets = [...coreNets, ...slice.nets.filter((n) => !coreNets.some((c) => c.id === n.id))];
    return assemble(name, plan, blocks, covers, [...plan.notes, ...floor, ...sliceNotes, ...routed.notes, ...warnings], generated, allNets);
  }
  return undefined;
}
