import { CATALOG, registerMachines } from '../catalog';
import { DIRS, addVec, posKey } from '../model/directions';
import { routeNetwork } from '../model/route';
import type { Build, FaceSetting, Facing, PlacedBlock, Vec3 } from '../model/types';
import { checkLine } from './check';
import { cableLoss } from './loss';
import { VOLTAGE, cableFor, pipeFor } from './power';
import type { GeneratedLine, LinePlan, PlanMachine, PlanMarker, PowerTier } from './types';

const TIERS: readonly PowerTier[] = ['LV', 'MV', 'HV'];
const SIDE_NAME = ['bottom', 'top', 'north side', 'south side', 'west side', 'east side'];
const WIDEN_TRIES = 6;

type ConduitKind = 'fluidPipe' | 'itemPipe' | 'cable';

/** A block to place: a recipe machine, generator, transformer or marker. */
interface Unit {
  role: string;
  key: string;
  name: string;
  pm?: PlanMachine;
  marker?: PlanMarker;
  transformer?: { from: PowerTier; to: PowerTier };
  /** Power tier the block runs on (machines). */
  tier?: PowerTier;
}
interface Placed extends Unit {
  pos: Vec3;
  facing?: Facing;
  /** GT basic machines: the front, toward the walkway. */
  mainFacing?: Facing;
  /** The network its output face belongs to. */
  facingNet?: string;
}

/** A network to route: a fluid, a group of items leaving the same machines, or one voltage of power. */
interface Net {
  id: string;
  kind: ConduitKind;
  name: string;
  conduit: string;
  /** Item/fluid: roles that put into / take from it. */
  producers: Set<string>;
  consumers: Set<string>;
  tier?: PowerTier;
  /** Power: the line's source voltage (runs through every slice). */
  source?: boolean;
  /** Item pipes: the item kinds sharing it, and where each should go. */
  parts?: { key: string; name: string; consumers: string[] }[];
}

interface Region {
  name: string;
  units: Placed[];
  min: Vec3;
  max: Vec3;
  /** Lane cells (straight runs along x) per network. */
  lanes: Map<string, Vec3[]>;
}

interface Routed {
  /** Conduit cell -> network id. */
  cells: Map<string, { pos: Vec3; net: string }>;
  /** `${cellKey}>${blockKey}` for every conduit side that connects to a block. */
  attach: Set<string>;
  /** The same, with the network and the block's role. */
  ends: { net: string; cell: Vec3; unit: Placed }[];
  covers: FaceSetting[];
  notes: string[];
}

const tierOf = (pm?: PlanMachine): PowerTier | undefined =>
  pm?.multiblock || !pm?.tier ? undefined : pm.tier === 'ULV' ? 'LV' : (pm.tier as PowerTier);
const isWalkway = (c: Vec3) => c[2] === 0 && (c[1] === 0 || c[1] === 1);
const sideTo = (from: Vec3, to: Vec3) => DIRS.findIndex((d) => from[0] + d[0] === to[0] && from[1] + d[1] === to[1] && from[2] + d[2] === to[2]) as Facing;

/** Networks for the plan: fluids one each; items merged by shared producer (they leave by one face); power per voltage. */
function planNets(plan: LinePlan, warnings: string[]): Net[] {
  const nets: Net[] = [];
  for (const n of plan.networks.filter((x) => x.kind === 'fluid')) {
    const pipe = pipeFor('fluid', n.flow);
    if (pipe.warning) warnings.push(`${n.name}: ${pipe.warning}`);
    nets.push({ id: `f:${n.key}`, kind: 'fluidPipe', name: n.name, conduit: pipe.key, producers: new Set(n.producers), consumers: new Set(n.consumers) });
  }
  const items = plan.networks.filter((x) => x.kind === 'item');
  const groups: (typeof items)[] = [];
  for (const n of items) {
    const g = groups.find((grp) => grp.some((m) => m.producers.some((p) => n.producers.includes(p))));
    if (g) g.push(n);
    else groups.push([n]);
  }
  for (const g of groups) {
    const flow = g.reduce((s, n) => s + n.flow, 0);
    const name = g.map((n) => n.name).join(' and ');
    nets.push({
      id: `i:${g.map((n) => n.key).join('+')}`, kind: 'itemPipe', name, conduit: pipeFor('item', flow).key,
      producers: new Set(g.flatMap((n) => n.producers)), consumers: new Set(g.flatMap((n) => n.consumers)),
      parts: g.map((n) => ({ key: n.key, name: n.name, consumers: n.consumers })),
    });
  }
  return nets;
}

/** Transformers a region needs so every lower voltage gets enough power from the source voltage. */
function transformersFor(units: Unit[], source: PowerTier): Unit[] {
  const demand = (t: PowerTier) => units.filter((u) => u.tier === t && !u.pm?.generator).reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
  const out: Unit[] = [];
  let carried = 0;
  for (let t = 0; t < TIERS.indexOf(source); t++) {
    carried += demand(TIERS[t]);
    if (carried <= 0) continue;
    const from = TIERS[t + 1];
    const to = TIERS[t];
    const key = from === 'MV' ? 'transformer_mv_lv' : 'transformer_hv_mv';
    const count = Math.ceil(carried / (VOLTAGE[to] * 4) - 1e-9);
    for (let i = 0; i < count; i++) out.push({ role: `xf:${from}-${to}`, key, name: CATALOG.get(key)!.name, transformer: { from, to }, tier: to });
  }
  return out;
}

const countTransformers = (units: Unit[]) => {
  const out: Partial<Record<PowerTier, number>> = {};
  for (const u of units) if (u.transformer) out[u.transformer.to] = (out[u.transformer.to] ?? 0) + 1;
  return out;
};

const machineUnits = (ms: PlanMachine[]): Unit[] =>
  ms.flatMap((pm) => Array.from({ length: pm.count }, () => ({
    role: pm.nodeId, key: pm.key, name: CATALOG.get(pm.key)?.name ?? pm.machine.name, pm, tier: tierOf(pm),
  })));
const markerUnits = (ms: PlanMarker[]): Unit[] =>
  ms.map((m) => ({
    role: m.id,
    key: m.kind === 'power' ? 'marker_power_in' : `marker_${m.kind}_${m.dir}`,
    name: m.kind === 'power' ? 'Power in' : `${m.dir === 'in' ? 'In' : 'Out'}`,
    marker: m,
  }));

/** Output face preferences: away from the walkway first, then outward vertically, then along the row. */
function facingPrefs(pos: Vec3, oneHigh: boolean): Facing[] {
  const back: Facing = pos[2] < 0 ? 2 : 3;
  if (oneHigh) return [back, 1, 0, 5, 4];
  return pos[1] === 0 ? [back, 0, 5, 4] : [back, 1, 5, 4];
}

/** Routes every network touching a region. Returns undefined when something can't be connected. */
function routeRegion(region: Region, nets: Net[], plan: LinePlan, oneHigh: boolean): Routed | { fail: string } {
  const occupied = new Map(region.units.map((u) => [posKey(u.pos), u]));
  const inBounds = (c: Vec3) => [0, 1, 2].every((a) => c[a] >= region.min[a] && c[a] <= region.max[a]);
  const netOf = new Map<string, string>(); // cell -> net (lanes, reserved faces, routed cells)
  for (const [id, cells] of region.lanes) for (const c of cells) netOf.set(posKey(c), id);
  const routed: Routed = { cells: new Map(), attach: new Set(), ends: [], covers: [], notes: [] };
  for (const [id, cells] of region.lanes) for (const c of cells) routed.cells.set(posKey(c), { pos: c, net: id });
  const usable = (c: Vec3, net: string) => {
    const k = posKey(c);
    return inBounds(c) && !occupied.has(k) && !isWalkway(c) && (netOf.get(k) === undefined || netOf.get(k) === net);
  };

  const sourceNet = (t: PowerTier) => nets.find((n) => n.kind === 'cable' && n.tier === t)!;
  const roleNets = (u: Placed) => nets.filter((n) => n.kind !== 'cable' && (n.producers.has(u.role) || n.consumers.has(u.role)));

  // 1. Output faces, decided up front so inputs never take them.
  for (const u of region.units) {
    let primary: Net | undefined;
    if (u.pm?.generator) primary = sourceNet(TIERS.find((t) => nets.some((n) => n.tier === t && n.source))!);
    else if (u.transformer) primary = sourceNet(u.transformer.from);
    else if (!u.marker) {
      const outs = roleNets(u).filter((n) => n.producers.has(u.role));
      primary = outs.find((n) => n.kind === 'itemPipe') ?? outs[0];
    }
    if (!primary) continue;
    const side = facingPrefs(u.pos, oneHigh).find((s) => usable(addVec(u.pos, DIRS[s]), primary.id));
    if (side === undefined) return { fail: `no free face for the output of the ${u.name}` };
    u.facing = side;
    u.facingNet = primary.id;
    netOf.set(posKey(addVec(u.pos, DIRS[side])), primary.id);
  }

  // 2. Each network: its lane (if any) plus every block that uses it, on the faces it may use.
  const powerEnds = (n: Net) =>
    region.units.flatMap((u): { u: Placed; mode: 'facing' | 'other' | 'any' }[] => {
      if (u.pm?.generator) return n.source ? [{ u, mode: 'facing' }] : [];
      if (u.transformer) return u.transformer.from === n.tier ? [{ u, mode: 'facing' }] : u.transformer.to === n.tier ? [{ u, mode: 'other' }] : [];
      if (u.marker?.kind === 'power') return n.source ? [{ u, mode: 'any' }] : [];
      if (u.tier === n.tier && !u.marker && !u.pm?.multiblock) return [{ u, mode: 'other' }];
      return [];
    });
  // Networks local to this region have the hardest paths (no long lane to land on), so they go first.
  const goods = nets.filter((n) => n.kind !== 'cable');
  const order = [
    ...goods.filter((n) => !region.lanes.has(n.id)),
    ...goods.filter((n) => region.lanes.has(n.id)),
    ...nets.filter((n) => n.kind === 'cable').reverse(),
  ];
  for (const n of order) {
    const ends = n.kind === 'cable'
      ? powerEnds(n)
      : region.units.flatMap((u): { u: Placed; mode: 'facing' | 'other' | 'any' | 'cover' }[] => {
          if (u.marker) return n.producers.has(u.role) || n.consumers.has(u.role) ? [{ u, mode: 'any' }] : [];
          if (n.producers.has(u.role)) return [{ u, mode: u.facingNet === n.id ? 'facing' : 'cover' }];
          if (n.consumers.has(u.role)) return [{ u, mode: 'other' }];
          return [];
        });
    const lane = region.lanes.get(n.id);
    if (!ends.length || ends.length + (lane ? 1 : 0) < 2) continue;
    const terminals: Vec3[][] = lane ? [lane] : [];
    for (const { u, mode } of ends) {
      const sides = mode === 'facing' ? [u.facing!] : mode === 'any' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5].filter((s) => s !== u.facing);
      terminals.push(sides.map((s) => addVec(u.pos, DIRS[s])).filter((c) => usable(c, n.id)));
    }
    const stuck = terminals.findIndex((t) => !t.length);
    if (stuck >= 0) return { fail: `no free face on the ${ends[stuck - (lane ? 1 : 0)]?.u.name ?? 'line'} for ${n.name}` };
    const blocked = new Set<string>(occupied.keys());
    for (const [k, id] of netOf) if (id !== n.id) blocked.add(k);
    for (let x = region.min[0]; x <= region.max[0]; x++) for (const y of [0, 1]) blocked.add(posKey([x, y, 0]));
    const avoid = new Set<string>();
    for (const u of region.units) for (const d of DIRS) avoid.add(posKey(addVec(u.pos, d)));
    let res;
    try {
      res = routeNetwork({ terminals, blocked, avoid, bounds: { min: region.min, max: region.max } });
    } catch {
      return { fail: `no room to run ${n.name} in the ${region.name}` };
    }
    for (const c of res.cells) {
      netOf.set(posKey(c), n.id);
      routed.cells.set(posKey(c), { pos: c, net: n.id });
    }
    ends.forEach(({ u, mode }, i) => {
      const cell = res.chosen[i + (lane ? 1 : 0)];
      routed.attach.add(`${posKey(cell)}>${posKey(u.pos)}`);
      routed.ends.push({ net: n.id, cell, unit: u });
      if (mode === 'cover') {
        const side = sideTo(u.pos, cell);
        const kind = n.kind === 'fluidPipe' ? 'pump' : 'conveyor';
        routed.covers.push({ pos: u.pos, side, kind });
        routed.notes.push(`Put a ${kind} cover on the ${SIDE_NAME[side]} of the ${u.name} at (${u.pos.join(', ')}), set to export, so ${n.name} goes into its own pipe.`);
      }
    });
  }

  // Machines with nothing to push out still need an output side: any free side but the front.
  for (const u of region.units) {
    if (u.facing !== undefined || u.marker) continue;
    const used = new Set([...routed.attach].filter((a) => a.endsWith(`>${posKey(u.pos)}`)).map((a) => a.split('>')[0]));
    u.facing = ([0, 1, 2, 3, 4, 5] as Facing[]).find((s) => s !== u.mainFacing && !used.has(posKey(addVec(u.pos, DIRS[s])))) as Facing;
  }

  // A pipe with several kinds of item ending at several places: places that should take one kind get an Item Filter.
  for (const n of nets) {
    if (!n.parts || n.parts.length < 2) continue;
    const takers = new Set(n.parts.flatMap((p) => p.consumers));
    if (takers.size < 2) continue;
    for (const end of routed.ends.filter((e) => e.net === n.id && takers.has(e.unit.role))) {
      const wants = n.parts.filter((p) => p.consumers.includes(end.unit.role));
      if (wants.length !== 1) continue;
      const item = wants[0];
      if (end.unit.marker) {
        const side = sideTo(end.cell, end.unit.pos);
        routed.covers.push({ pos: end.cell, side, kind: 'itemFilter', item: item.key });
        routed.notes.push(`Put an Item Filter cover set to ${item.name} on the pipe at (${end.cell.join(', ')}), on its ${SIDE_NAME[side]} next to the ${item.name} chest, so only ${item.name} goes in.`);
      } else {
        const side = sideTo(end.unit.pos, end.cell);
        routed.covers.push({ pos: end.unit.pos, side, kind: 'itemFilter', item: item.key });
        routed.notes.push(`Put an Item Filter cover set to ${item.name} on the ${SIDE_NAME[side]} of the ${end.unit.name} at (${end.unit.pos.join(', ')}), so only ${item.name} goes in from that pipe.`);
      }
    }
  }
  void plan;
  return routed;
}

/** Conduit masks: on toward same-network neighbours and the blocks they serve; lanes also stay open along x. */
function conduitBlocks(routed: Routed, nets: Net[], laneIds: Set<string>, laneCells: Set<string>): PlacedBlock[] {
  const byId = new Map(nets.map((n) => [n.id, n]));
  return [...routed.cells.values()].map(({ pos, net }) => {
    let on = 0;
    DIRS.forEach((d, side) => {
      const nk = posKey(addVec(pos, d));
      if (routed.cells.get(nk)?.net === net || routed.attach.has(`${posKey(pos)}>${nk}`)) on |= 1 << side;
    });
    if (laneIds.has(net) && laneCells.has(posKey(pos))) on |= (1 << 4) | (1 << 5);
    return { pos, key: byId.get(net)!.conduit, manualMask: { forcedOn: on, forcedOff: 63 & ~on } };
  });
}

const unitBlock = (u: Placed): PlacedBlock => ({
  pos: u.pos, key: u.key, role: u.role,
  ...(u.facing !== undefined ? { facing: u.facing } : {}),
  ...(u.mainFacing !== undefined ? { mainFacing: u.mainFacing } : {}),
});

/** GregTech basic machines get a front toward the walkway; generators, transformers and markers don't have one. */
const withFront = (u: Placed): Placed =>
  u.pm && !u.pm.generator && !u.pm.multiblock && !u.transformer ? { ...u, mainFacing: u.pos[2] < 0 ? 3 : 2 } : u;

const LANE_SLOTS: readonly [number, number][] = [
  [0, -3], [0, 3], [1, -3], [1, 3], [-1, -3], [-1, 3], [2, -3], [2, 3],
  [0, -4], [0, 4], [1, -4], [1, 4], [-1, -4], [-1, 4], [2, -4], [2, 4],
];

/** `localTransformers`: the most transformers stepping down to each voltage in any one region (that region's network). */
function powerNets(plan: LinePlan, units: Unit[], localTransformers: Partial<Record<PowerTier, number>>, warnings: string[]): Net[] {
  const source = plan.power.source.tier;
  const sourceEut = plan.power.source.kind === 'outside'
    ? plan.power.source.eut
    : units.filter((u) => u.pm?.generator).reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
  return TIERS.filter((t) => TIERS.indexOf(t) <= TIERS.indexOf(source)).map((t) => {
    const amps = t === source
      ? sourceEut / VOLTAGE[t]
      : (localTransformers[t] ?? 0) * 4;
    const cable = cableFor(t, Math.max(1, amps));
    if (cable.warning) warnings.push(cable.warning);
    return { id: `p:${t}`, kind: 'cable' as const, name: `${t} power`, conduit: cable.key, producers: new Set<string>(), consumers: new Set<string>(), tier: t, source: t === source };
  });
}

function assemble(name: string, plan: LinePlan, blocks: PlacedBlock[], covers: FaceSetting[], notes: string[], generated?: GeneratedLine): Build {
  const machines = [...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])]
    .filter((m) => m.key.startsWith('gt_'))
    .map((m) => m.machine);
  const unique = [...new Map(machines.map((m) => [m.key, m])).values()];
  registerMachines(unique);
  return {
    version: 1,
    name,
    blocks,
    ...(unique.length ? { machines: unique } : {}),
    ...(notes.length ? { notes } : {}),
    ...(covers.length ? { covers } : {}),
    ...(generated ? { generated } : {}),
  };
}

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
    return assemble(name, plan, blocks, routed.covers, [...plan.notes, ...routed.notes, ...warnings]);
  }
  return undefined;
}

/** Core + identical slices around a walkway, machines two high in the slices. */
function buildModular(plan: LinePlan, name: string, warnings: string[]): Build | undefined {
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
  if (laneNets.length > LANE_SLOTS.length) return undefined;
  const laneIds = new Set(laneNets.map((n) => n.id));
  const lanesFor = (x0: number, x1: number) =>
    new Map(laneNets.map((n, i) => [n.id, Array.from({ length: x1 - x0 + 1 }, (_, k) => [x0 + k, LANE_SLOTS[i][0], LANE_SLOTS[i][1]] as Vec3)]));
  // Local voltages (below the source) are separate networks in each slice and in the core.
  const local = (suffix: string) => nets.map((n) => (n.kind === 'cable' && !n.source ? { ...n, id: `${n.id}:${suffix}` } : n));

  const columns = Math.ceil(sliceUnits.length / 4);
  let lastFail = '';
  for (let extra = 0; extra < WIDEN_TRIES; extra++) {
    // Machine columns at odd x, so every machine has a free gap column on both sides inside its own slice.
    const L = 2 * columns + 1 + extra;
    const slots: Vec3[] = [];
    for (let c = 0; c < columns; c++) slots.push([2 * c + 1, 0, -1], [2 * c + 1, 1, -1], [2 * c + 1, 0, 1], [2 * c + 1, 1, 1]);
    const slicePlaced: Placed[] = sliceUnits.map((u, i) => withFront({ ...u, pos: slots[i] }));
    const sliceRegion: Region = { name: 'slice', units: slicePlaced, min: [0, -1, -5], max: [L - 1, 3, 5], lanes: lanesFor(0, L - 1) };
    const sliceNets = local('slice');
    const sliceRouted = routeRegion(sliceRegion, sliceNets, plan, false);
    if ('fail' in sliceRouted) {
      lastFail = sliceRouted.fail;
      continue;
    }

    const coreCount = Math.max(Math.ceil(coreUnits.length / 2), Math.ceil(markers.length / 2), 1);
    const C = 2 * coreCount + 2 + 2 * extra;
    const coreStart = -C;
    const corePlaced: Placed[] = [
      ...coreUnits.map((u, i): Placed => withFront({ ...u, pos: [coreStart + 1 + 2 * Math.floor(i / 2), 0, i % 2 ? 1 : -1] })),
      ...markers.map((u, i): Placed => ({ ...u, pos: [coreStart + 1 + 2 * Math.floor(i / 2), 0, i % 2 ? 5 : -5] })),
    ];
    const coreRegion: Region = { name: 'core', units: corePlaced, min: [coreStart, -1, -5], max: [-1, 3, 5], lanes: lanesFor(coreStart, -1) };
    const coreNets = local('core');
    const coreRouted = routeRegion(coreRegion, coreNets, plan, true);
    if ('fail' in coreRouted) {
      lastFail = coreRouted.fail;
      continue;
    }

    const laneCellsOf = (r: Region) => new Set([...r.lanes.values()].flat().map(posKey));
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
    return assemble(name, plan, blocks, covers, [...plan.notes, ...sliceNotes, ...coreRouted.notes, ...warnings], generated);
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
  for (;;) {
    const out = buildOnce(p, name);
    const lost = Math.round(cableLoss(out.build, p).total);
    const used = Object.values(p.power.demand).reduce((s, x) => s + (x ?? 0), 0);
    const gens = out.build.blocks.filter((b) => [...(p.slice ?? []), ...p.core, ...(p.straight ?? [])].some((m) => m.generator && m.nodeId === b.role));
    const genEut = [...(p.slice ?? []), ...p.core, ...(p.straight ?? [])].find((m) => m.generator)?.eut ?? 0;
    const short = p.power.source.kind === 'generators' && gens.length * genEut < used + lost;
    if (!short || extra >= 3) {
      const notes = [
        ...(lost > 0
          ? [p.power.source.kind === 'generators'
              ? `Cables lose about ${lost} EU/t (the generators cover it)`
              : `Cables lose about ${lost} EU/t — bring in ${Math.ceil(used + lost)} EU/t`]
          : []),
        ...(extra ? [`Added ${extra} extra generator${extra > 1 ? 's' : ''} ${p.style === 'modular' ? 'per slice ' : ''}to cover cable loss`] : []),
        ...(short ? [`The generators still fall short of what the machines use plus cable loss — add more`] : []),
      ];
      out.build.notes = [...(out.build.notes ?? []), ...notes];
      return out;
    }
    p = withExtraGenerator(p);
    extra++;
  }
}

/** The plan with one more generator where the generators live (each slice, the core, or the straight line). */
function withExtraGenerator(plan: LinePlan): LinePlan {
  const bump = (ms?: PlanMachine[]) => ms?.map((m) => (m.generator ? { ...m, count: m.count + 1 } : m));
  if (plan.slice?.some((m) => m.generator)) return { ...plan, slice: bump(plan.slice) };
  if (plan.core.some((m) => m.generator)) return { ...plan, core: bump(plan.core)! };
  return { ...plan, straight: bump(plan.straight) };
}

/**
 * Lays the plan out as blocks: modular (core + identical slices) or a straight line, every network routed and
 * checked. A modular line that won't fit falls back to a straight line, saying so.
 */
function buildOnce(plan: LinePlan, name: string): { build: Build; warnings: string[] } {
  const warnings: string[] = [];
  if (plan.style === 'modular') {
    const b = buildModular(plan, name, warnings);
    if (b && !checkLine(b, plan).length) return { build: b, warnings };
    warnings.push("Couldn't fit this line into identical slices, so it's laid out in a straight line instead.");
  }
  const straightPlan: LinePlan = plan.style === 'straight' ? plan : { ...plan, style: 'straight', straight: [...(plan.slice ?? []).map((m) => ({ ...m, count: m.count * plan.sliceCount })), ...plan.core] };
  const b = buildStraight(straightPlan, name, warnings);
  if (!b) throw new Error("Couldn't lay out this line: there isn't room to connect all its pipes and cables.");
  const problems = checkLine(b, straightPlan);
  if (problems.length) b.notes = [...(b.notes ?? []), 'Check these before building:', ...problems];
  return { build: b, warnings };
}
