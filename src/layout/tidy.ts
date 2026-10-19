import { DIRS, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock, Vec3 } from '../model/types';
import { checkLine } from './check';
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
import type { GeneratedLine, LinePlan } from './types';

export const FLOOR_NOTE = 'The floor pipes sit one block below the walkway: dig one layer for them';
export const UNTIDY_NOTE = "Couldn't keep this line tidy, so some pipes take detours";

/** Row arrangements tried per line, best first. */
const ARRANGEMENTS_TRIED = 8;
const CORE_WIDEN_TRIES = 6;
const BEND_PENALTY = 2;

/** Lexicographic: the first differing entry decides. */
const lessThan = (a: number[], b: number[]) => {
  const i = a.findIndex((v, k) => v !== b[k]);
  return i >= 0 && a[i] < b[i];
};

const shift = (b: PlacedBlock, dx: number): PlacedBlock => ({ ...b, pos: [b.pos[0] + dx, b.pos[1], b.pos[2]] });

/**
 * A modular line in the tidy cross-section: identical slices (see `tidySlice`) either side of a core. The core's
 * one-off machines, markers and step-down transformers sit in a row at the walkway, routed with the slices'
 * through-runs as lanes. Tries several row arrangements and keeps the narrowest, shortest, smallest line that passes
 * the checker; undefined when none does.
 */
export function buildTidy(plan: LinePlan, name: string, warnings: string[]): Build | undefined {
  if (plan.style !== 'modular' || !plan.slice?.length) return undefined;
  const source = plan.power.source.tier;
  const sliceMachines = machineUnits(plan.slice);
  const coreMachines = machineUnits(plan.core);
  const everyMachine = [...sliceMachines.flatMap((u) => Array.from({ length: plan.sliceCount }, () => u)), ...coreMachines];
  const markers = markerUnits(plan.markers);
  const netWarnings: string[] = [];
  const nets = [...planNets(plan, netWarnings), ...powerNets(plan, everyMachine, countTransformers(transformersFor(coreMachines, source)), netWarnings)];

  let best: { build: Build; score: number[] } | undefined;
  for (const arr of arrangeRows(plan.slice).slice(0, ARRANGEMENTS_TRIED)) {
    for (const width of [1, 2]) {
      const slice = tidySlice(arr, nets, plan, width);
      if ('fail' in slice) continue;
      const build = withCore(plan, name, slice, nets, coreMachines, everyMachine, markers, [...warnings, ...netWarnings]);
      if (!build || checkLine(build, plan).length) continue;
      const span = (a: number) => Math.max(...build.blocks.map((b) => b.pos[a])) - Math.min(...build.blocks.map((b) => b.pos[a])) + 1;
      const score = [span(2), slice.length, build.blocks.length];
      if (!best || lessThan(score, best.score)) best = { build, score };
      break; // a wider service column only helps when the narrow one fails
    }
  }
  return best?.build;
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
  for (const [i, u] of units.filter((x) => !x.transformer).entries()) {
    const x = start + 1 + 2 * i;
    const spots = ROW_SPOTS.map(([y, z]): Vec3 => [x, y, z]).filter(free);
    if (!spots.length) return undefined;
    spots.sort((a, b) => faces(b) - faces(a) || a[1] - b[1] || (a[2] === side(u) ? -1 : 0) - (b[2] === side(u) ? -1 : 0));
    put(u, spots[0]);
  }
  for (const t of units.filter((x) => x.transformer)) {
    const near = placed
      .filter((m) => !m.transformer && m.tier === t.transformer!.to)
      .flatMap((m) => [1, -1].map((dx): Vec3 => [m.pos[0] + dx, m.pos[1], m.pos[2]]))
      .find((c) => free(c) && c[0] >= start && c[0] < start + length);
    const any = Array.from({ length }, (_, k) => start + k).flatMap((x) => ROW_SPOTS.map(([y, z]): Vec3 => [x, y, z])).find(free);
    const pos = near ?? any;
    if (!pos) return undefined;
    put(t, pos);
  }
  return placed;
}

/** The core for a tidy slice, and the whole line assembled around it. */
function withCore(plan: LinePlan, name: string, slice: TidySlice, nets: Net[], coreMachines: Unit[], everyMachine: Unit[], markers: Unit[], warnings: string[]): Build | undefined {
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
    const lanes = new Map([...slice.throughRuns].map(([id, runs]) => [id, runs.map((r) => Array.from({ length: C }, (_, k): Vec3 => [coreMin + k, r[0][1], r[0][2]]))]));
    const keepClear = new Set(Array.from({ length: C }, (_, k) => posKey([coreMin + k, -1, 0])));
    const taken = new Set([...keepClear, ...[...lanes.values()].flat(2).map(posKey)]);
    const corePlaced: Placed[] = [
      ...markers.map((u, i): Placed => ({ ...u, pos: [coreMin + Math.floor(i / 4), [0, 0, 2, 2][i % 4], [-1, 1, -1, 1][i % 4]] })),
    ];
    for (const p of corePlaced) taken.add(posKey(p.pos));
    const core = placeTidyCore(coreUnits, coreMin + markerColumns, C - markerColumns, coreSide, taken);
    if (!core) continue;
    corePlaced.push(...core.map(withFront));
    const region: Region = {
      name: 'core', units: corePlaced, min: [coreMin, TIDY_BOUNDS.yMin, -TIDY_BOUNDS.zMax], max: [-1, TIDY_BOUNDS.yMax, TIDY_BOUNDS.zMax],
      lanes, keepClear, bendPenalty: BEND_PENALTY,
    };
    const routed = routeRegion(region, coreNets, plan, true);
    if ('fail' in routed) continue;

    const right = Math.ceil(plan.sliceCount / 2);
    const left = plan.sliceCount - right;
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
    const generated: GeneratedLine = {
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
