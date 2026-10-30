import { CATALOG, registerMachines } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import { routeNetwork } from '../model/route';
import type { Build, FaceSetting, Facing, LineNetwork, PlacedBlock, PortKind, Vec3 } from '../model/types';
import { structureFor } from './multiblock';
import { VOLTAGE, cableFor, pipeFor } from './power';
import type { GeneratedLine, LinePlan, PlanMachine, PlanMarker, PowerTier } from './types';

export const TIERS: readonly PowerTier[] = ['LV', 'MV', 'HV'];

export const SIDE_NAME = ['bottom', 'top', 'north side', 'south side', 'west side', 'east side'];

export type ConduitKind = 'fluidPipe' | 'itemPipe' | 'cable';

/** A block to place: a recipe machine, generator, transformer or marker. */
export interface Unit {
  role: string;
  key: string;
  name: string;
  pm?: PlanMachine;
  marker?: PlanMarker;
  /** `up`: set to step up (soft mallet) — `from` (lower) in on five faces, `to` (higher) out of its facing. */
  transformer?: { from: PowerTier; to: PowerTier; up?: boolean };
  /** Power tier the block runs on (machines; a multiblock's energy hatch). */
  tier?: PowerTier;
  /** A multiblock's hatch or bus: what it does, and the resources it handles (its pipe or cable is on its `facing`). */
  port?: { kind: PortKind; keys: string[] };
  /** Part of a multiblock: placed with its facing already set, which routing keeps. */
  fixed?: boolean;
}

export interface Placed extends Unit {
  pos: Vec3;
  facing?: Facing;
  /** GT basic machines: the front, toward the walkway. */
  mainFacing?: Facing;
  /** The network its output face belongs to. */
  facingNet?: string;
}

/** A network to route: a fluid, a group of items leaving the same machines, or one voltage of power. */
export interface Net {
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

export interface Region {
  name: string;
  units: Placed[];
  min: Vec3;
  max: Vec3;
  /** Lanes per network: straight runs along x, already in place. Several runs of one network get joined here. */
  lanes: Map<string, Vec3[][]>;
  /** Cells nothing may use besides the walkway (e.g. the floor under it). */
  keepClear?: Set<string>;
  /** Extra cost per bend, so routes come out straight (default 0). */
  bendPenalty?: number;
  /** false: no walkway to keep clear (tidy lines). */
  walkway?: boolean;
  /** Extra cost of a pipe passing next to a machine face (default 40; cables 2). */
  avoidPenalty?: number;
}

export interface Routed {
  /** Conduit cell -> network id. */
  cells: Map<string, { pos: Vec3; net: string }>;
  /** `${cellKey}>${blockKey}` for every conduit side that connects to a block. */
  attach: Set<string>;
  /** The same, with the network and the block's role. */
  ends: { net: string; cell: Vec3; unit: Placed }[];
  covers: FaceSetting[];
  notes: string[];
}

/** The power tier a machine runs on; a multiblock only has one when it's planned as itself. */
export const tierOf = (pm?: PlanMachine): PowerTier | undefined =>
  (pm?.multiblock && !structureFor(pm)) || !pm?.tier ? undefined : pm.tier === 'ULV' ? 'LV' : (pm.tier as PowerTier);

/** A multiblock without a structure: a one-block stand-in the player builds by hand, which the line doesn't power. */
export const handBuilt = (pm?: PlanMachine): boolean => !!pm?.multiblock && !structureFor(pm);

/** What a network carries: its item kinds, or its one fluid. */
const netKeys = (n: Net) => n.parts?.map((p) => p.key) ?? [n.id.slice(2)];

/** Networks a multiblock port ends: those it carries a key of, in its direction. */
const portNets = (u: Placed, nets: Net[]) => nets.filter((n) => n.kind !== 'cable' && u.port && netKeys(n).some((k) => u.port!.keys.includes(k)) &&
  (u.port.kind === 'out' ? n.producers.has(u.role) : u.port.kind === 'in' && n.consumers.has(u.role)));

/** A multiblock's input bus: GT puts items into it through its front only (MTEHatchInputBus.allowPutStack). */
const frontOnly = (u: Placed) => u.port?.kind === 'in' && u.key.startsWith('bus_input');

const isWalkway =(c: Vec3) => c[2] === 0 && (c[1] === 0 || c[1] === 1);

export const sideTo = (from: Vec3, to: Vec3) => DIRS.findIndex((d) => from[0] + d[0] === to[0] && from[1] + d[1] === to[1] && from[2] + d[2] === to[2]) as Facing;

/** Networks for the plan: fluids one each; items merged by shared producer (they leave by one face); power per voltage. */
export function planNets(plan: LinePlan, warnings: string[]): Net[] {
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
  // Items that all go to exactly the same machines share one pipe too: every taker takes all of them (no filter), and a
  // machine with several item inputs then needs one face for them, not one each.
  const takers = (g: typeof items) => [...new Set(g.flatMap((n) => n.consumers))].sort().join('|');
  for (let i = 0; i < groups.length; i++) {
    for (let j = groups.length - 1; j > i; j--) {
      if (takers(groups[i]) === takers(groups[j]) && !groups[i].some((n) => n.consumers.some((c) => c.startsWith('out:')))) {
        groups[i].push(...groups[j]);
        groups.splice(j, 1);
      }
    }
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
export function transformersFor(units: Unit[], source: PowerTier): Unit[] {
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

/**
 * Transformers set to step up from the source to each voltage above it that machines use: each gives 1 A of the higher
 * voltage (from 4 A of the lower), so one per amp of what the machines at or above that voltage use.
 */
export function stepUpsFor(units: Unit[], source: PowerTier): Unit[] {
  const out: Unit[] = [];
  const machines = units.filter((u) => u.tier && !u.pm?.generator && !u.transformer);
  for (let t = TIERS.indexOf(source) + 1; t < TIERS.length; t++) {
    const carried = machines.filter((u) => TIERS.indexOf(u.tier!) >= t).reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
    if (carried <= 0) continue;
    const from = TIERS[t - 1];
    const to = TIERS[t];
    const key = to === 'MV' ? 'transformer_mv_lv' : 'transformer_hv_mv';
    const count = Math.ceil(carried / VOLTAGE[to] - 1e-9);
    for (let i = 0; i < count; i++) out.push({ role: `xu:${from}-${to}`, key, name: CATALOG.get(key)!.name, transformer: { from, to, up: true }, tier: to });
  }
  return out;
}

export const countTransformers = (units: Unit[]) => {
  const out: Partial<Record<PowerTier, number>> = {};
  for (const u of units) if (u.transformer) out[u.transformer.to] = (out[u.transformer.to] ?? 0) + 1;
  return out;
};

export const machineUnits = (ms: PlanMachine[]): Unit[] =>
  ms.flatMap((pm) => Array.from({ length: pm.count }, () => ({
    role: pm.nodeId, key: pm.key, name: CATALOG.get(pm.key)?.name ?? pm.machine.name, pm, tier: tierOf(pm),
  })));

export const markerUnits = (ms: PlanMarker[]): Unit[] =>
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
export function routeRegion(region: Region, nets: Net[], plan: LinePlan, oneHigh: boolean): Routed | { fail: string } {
  const occupied = new Map(region.units.map((u) => [posKey(u.pos), u]));
  const inBounds = (c: Vec3) => [0, 1, 2].every((a) => c[a] >= region.min[a] && c[a] <= region.max[a]);
  const netOf = new Map<string, string>(); // cell -> net (lanes, reserved faces, routed cells)
  for (const [id, runs] of region.lanes) for (const c of runs.flat()) netOf.set(posKey(c), id);
  const routed: Routed = { cells: new Map(), attach: new Set(), ends: [], covers: [], notes: [] };
  for (const [id, runs] of region.lanes) for (const c of runs.flat()) routed.cells.set(posKey(c), { pos: c, net: id });
  const usable = (c: Vec3, net: string) => {
    const k = posKey(c);
    return inBounds(c) && !occupied.has(k) && !(region.walkway !== false && isWalkway(c)) && !region.keepClear?.has(k) && (netOf.get(k) === undefined || netOf.get(k) === net);
  };

  const sourceNet = (t: PowerTier) => nets.find((n) => n.kind === 'cable' && n.tier === t)!;
  const roleNets = (u: Placed) => nets.filter((n) => n.kind !== 'cable' && (n.producers.has(u.role) || n.consumers.has(u.role)));

  // 1. Output faces, decided up front so inputs never take them. A multiblock's parts keep their facing: the cell in
  // front of a hatch is its network's (an energy hatch's, its voltage's), reserved before anything else picks a face.
  for (const u of region.units) {
    if (!u.fixed || !u.port || u.facing === undefined) continue;
    const net = u.port.kind === 'energy' ? (u.tier && nets.find((n) => n.kind === 'cable' && n.tier === u.tier)) : portNets(u, nets)[0];
    if (!net) continue;
    const cell = addVec(u.pos, DIRS[u.facing]);
    if (!usable(cell, net.id)) return { fail: `no room in front of the ${u.name} for ${net.name}` };
    u.facingNet = net.id;
    netOf.set(posKey(cell), net.id);
  }
  for (const u of region.units) {
    if (u.fixed) continue;
    let primary: Net | undefined;
    if (u.pm?.generator) primary = sourceNet(u.tier ?? TIERS.find((t) => nets.some((n) => n.tier === t && n.source))!);
    else if (u.transformer) primary = sourceNet(u.transformer.up ? u.transformer.to : u.transformer.from);
    else if (!u.marker) {
      const outs = roleNets(u).filter((n) => n.producers.has(u.role));
      primary = outs.find((n) => n.kind === 'itemPipe') ?? outs[0];
    }
    if (!primary) continue;
    // A power output never sits beside another voltage's output cell (they'd join when built by hand).
    const clashes = (c: Vec3) => primary.kind === 'cable' && DIRS.some((d) => {
      const other = nets.find((x) => x.id === netOf.get(posKey(addVec(c, d))));
      return other?.kind === 'cable' && other.tier !== primary.tier;
    });
    const prefs = facingPrefs(u.pos, oneHigh).filter((s) => usable(addVec(u.pos, DIRS[s]), primary.id));
    const side = prefs.find((s) => !clashes(addVec(u.pos, DIRS[s]))) ?? prefs[0];
    if (side === undefined) return { fail: `no free face for the output of the ${u.name}` };
    u.facing = side;
    u.facingNet = primary.id;
    netOf.set(posKey(addVec(u.pos, DIRS[side])), primary.id);
  }

  // Machines touching a transformer of their voltage (not on its input side or their own front) get power straight
  // from it, with no cable.
  const directlyPowered = new Set<string>();
  for (const t of region.units) {
    if (!t.transformer || t.transformer.up) continue;
    DIRS.forEach((d, side) => {
      if (side === t.facing) return;
      const m = occupied.get(posKey(addVec(t.pos, d)));
      if (!m || m.transformer || m.marker || m.fixed || m.pm?.generator || m.tier !== t.transformer!.to) return;
      if (sideTo(m.pos, t.pos) === m.mainFacing) return;
      directlyPowered.add(posKey(m.pos));
    });
  }

  // 2. Each network: its lane (if any) plus every block that uses it, on the faces it may use.
  const powerEnds = (n: Net) =>
    region.units.flatMap((u): { u: Placed; mode: 'facing' | 'other' | 'any' }[] => {
      if (u.pm?.generator) return (u.tier ? u.tier === n.tier : n.source) ? [{ u, mode: 'facing' }] : [];
      if (u.transformer?.up) return u.transformer.from === n.tier ? [{ u, mode: 'other' }] : u.transformer.to === n.tier ? [{ u, mode: 'facing' }] : [];
      if (u.transformer) return u.transformer.from === n.tier ? [{ u, mode: 'facing' }] : u.transformer.to === n.tier ? [{ u, mode: 'other' }] : [];
      if (u.marker?.kind === 'power') return n.source ? [{ u, mode: 'any' }] : [];
      // A multiblock takes power through its energy hatch's front alone.
      if (u.port) return u.port.kind === 'energy' && u.tier === n.tier ? [{ u, mode: 'facing' }] : [];
      if (u.fixed) return [];
      if (u.tier === n.tier && !u.marker && !u.pm?.multiblock && !directlyPowered.has(posKey(u.pos))) return [{ u, mode: 'other' }];
      return [];
    });
  // Networks local to this region have the hardest paths (no long lane to land on), so they go first.
  const goods = nets.filter((n) => n.kind !== 'cable');
  const order = [
    ...goods.filter((n) => !region.lanes.has(n.id)),
    ...goods.filter((n) => region.lanes.has(n.id)),
    ...nets.filter((n) => n.kind === 'cable').reverse(),
  ];
  /** Cells a route for `n` may not use: blocks, other networks, the walkway, kept-clear cells, other voltages. */
  const blockedFor = (n: Net) => {
    const blocked = new Set<string>(occupied.keys());
    for (const [k, id] of netOf) if (id !== n.id) blocked.add(k);
    if (region.walkway !== false) for (let x = region.min[0]; x <= region.max[0]; x++) for (const y of [0, 1]) blocked.add(posKey([x, y, 0]));
    for (const k of region.keepClear ?? []) blocked.add(k);
    // A cable never runs beside a cable of another voltage or a higher-voltage transformer: GT cables join whatever
    // they're placed against, so touching is a burn risk when building by hand.
    if (n.kind === 'cable') {
      const apart = (c: Vec3) => DIRS.forEach((d) => {
        const k = posKey(addVec(c, d));
        if (netOf.get(k) !== n.id) blocked.add(k);
      });
      for (const [k, id] of netOf) {
        const other = nets.find((x) => x.id === id);
        if (other?.kind === 'cable' && other.tier !== n.tier) apart(routed.cells.get(k)?.pos ?? (k.split(',').map(Number) as unknown as Vec3));
      }
      for (const u of region.units) {
        if (!u.transformer) continue;
        // Step-down: its low-voltage output faces; step-up: its low-voltage input faces (anything else must keep off).
        if (u.transformer.up ? n.tier !== u.transformer.from : TIERS.indexOf(u.transformer.to) > TIERS.indexOf(n.tier!)) apart(u.pos);
      }
    }
    return blocked;
  };
  const done: { n: Net; ends: Vec3[]; lanes: Vec3[][] }[] = [];
  for (const n of order) {
    const ends = n.kind === 'cable'
      ? powerEnds(n)
      : region.units.flatMap((u): { u: Placed; mode: 'facing' | 'other' | 'any' | 'cover' }[] => {
          if (u.marker) return n.producers.has(u.role) || n.consumers.has(u.role) ? [{ u, mode: 'any' }] : [];
          // A hatch ends the networks it carries: an output and an input bus only through their front (a second network
          // into a bus then finds its front taken, and fails), an input hatch on any free face.
          if (u.fixed) return portNets(u, [n]).length ? [{ u, mode: u.facingNet === n.id || u.port!.kind === 'out' || frontOnly(u) ? 'facing' : 'other' }] : [];
          if (n.producers.has(u.role)) return [{ u, mode: u.facingNet === n.id ? 'facing' : 'cover' }];
          if (n.consumers.has(u.role)) return [{ u, mode: 'other' }];
          return [];
        });
    const lanes = region.lanes.get(n.id) ?? [];
    if (ends.length + lanes.length < 2) continue;
    const terminals: Vec3[][] = [...lanes];
    for (const { u, mode } of ends) {
      const sides = mode === 'facing' ? [u.facing!] : mode === 'any' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5].filter((s) => s !== u.facing);
      terminals.push(sides.map((s) => addVec(u.pos, DIRS[s])).filter((c) => usable(c, n.id)));
    }
    const stuck = terminals.findIndex((t) => !t.length);
    if (stuck >= 0) {
      const end = ends[stuck - lanes.length]?.u;
      if (end && frontOnly(end)) return { fail: `the front of the ${end.name} is taken, and it takes ${n.name} only through its front` };
      return { fail: `no free face on the ${end?.name ?? 'line'} for ${n.name}` };
    }
    const blocked = blockedFor(n);
    // Steer clear of machine faces and of the cells around other machines' output faces, so no output gets boxed in.
    const avoid = new Set<string>();
    for (const u of region.units) {
      // A multiblock's walls have no faces to keep free (its hatches' cells are reserved).
      if (!u.fixed) for (const d of DIRS) avoid.add(posKey(addVec(u.pos, d)));
      if (u.facing !== undefined && u.facingNet !== n.id) {
        const out = addVec(u.pos, DIRS[u.facing]);
        for (const d of DIRS) avoid.add(posKey(addVec(out, d)));
      }
    }
    let res;
    try {
      // Machine faces are scarce: routes pass next to a machine only when there's no other way.
      // Power goes last, when every pipe already has its faces, so cables can take the short way (less EU lost).
      res = routeNetwork({ terminals, blocked, avoid, avoidPenalty: n.kind === 'cable' ? 2 : region.avoidPenalty ?? 40, bendPenalty: region.bendPenalty, bounds: { min: region.min, max: region.max } });
    } catch {
      return { fail: `no room to run ${n.name} in the ${region.name}` };
    }
    for (const c of res.cells) {
      netOf.set(posKey(c), n.id);
      routed.cells.set(posKey(c), { pos: c, net: n.id });
    }
    done.push({ n, ends: res.chosen.slice(lanes.length), lanes });
    ends.forEach(({ u, mode }, i) => {
      const cell = res.chosen[i + lanes.length];
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

  // Tidy-up: re-route each network on its own between the same end blocks, now that everything else is in place and
  // without the push away from machine faces (which made early routes dip round later ones); keep it if shorter.
  for (let round = 0, shorter = true; shorter && round < 3; round++) {
  shorter = false;
  for (const { n, ends: endCells, lanes } of done) {
    const fixed = new Set([...lanes.flat(), ...endCells].map(posKey));
    const old = [...routed.cells].filter(([k, c]) => c.net === n.id && !fixed.has(k)).map(([k]) => k);
    if (!old.length) continue;
    for (const k of old) netOf.delete(k);
    let res;
    try {
      res = routeNetwork({ terminals: [...lanes, ...endCells.map((c) => [c])], blocked: blockedFor(n), bendPenalty: region.bendPenalty, bounds: { min: region.min, max: region.max } });
    } catch {
      res = undefined;
    }
    const added = res ? res.cells.filter((c) => !fixed.has(posKey(c))) : [];
    if (res && added.length < old.length) {
      for (const k of old) routed.cells.delete(k);
      for (const c of added) {
        netOf.set(posKey(c), n.id);
        routed.cells.set(posKey(c), { pos: c, net: n.id });
      }
      shorter = true;
    } else for (const k of old) netOf.set(k, n.id);
  }
  }

  // Machines with nothing to push out still need an output side: any free side but the front.
  for (const u of region.units) {
    if (u.facing !== undefined || u.marker || u.fixed) continue;
    const used = new Set([...routed.attach].filter((a) => a.endsWith(`>${posKey(u.pos)}`)).map((a) => a.split('>')[0]));
    u.facing = ([0, 1, 2, 3, 4, 5] as Facing[]).find((s) => s !== u.mainFacing && !used.has(posKey(addVec(u.pos, DIRS[s])))) as Facing;
  }

  itemFilters(routed, nets);
  void plan;
  return routed;
}

/** A pipe with several kinds of item ending at several places: places that should take one kind get an Item Filter. */
export function itemFilters(routed: Routed, nets: Net[]): void {
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
        routed.notes.push(`Put an Item Filter cover set to ${item.name} on the pipe at (${end.cell.join(', ')}), on its ${SIDE_NAME[side]} next to the ${item.name} drawer, so only ${item.name} goes in.`);
      } else {
        const side = sideTo(end.unit.pos, end.cell);
        routed.covers.push({ pos: end.unit.pos, side, kind: 'itemFilter', item: item.key });
        routed.notes.push(`Put an Item Filter cover set to ${item.name} on the ${SIDE_NAME[side]} of the ${end.unit.name} at (${end.unit.pos.join(', ')}), so only ${item.name} goes in from that pipe.`);
      }
    }
  }
}

/** Conduit masks: on toward same-network neighbours and the blocks they serve; lanes also stay open along x. */
export function conduitBlocks(routed: Routed, nets: Net[], laneIds: Set<string>, laneCells: Set<string>): PlacedBlock[] {
  const byId = new Map(nets.map((n) => [n.id, n]));
  return [...routed.cells.values()].map(({ pos, net }) => {
    let on = 0;
    DIRS.forEach((d, side) => {
      const nk = posKey(addVec(pos, d));
      if (routed.cells.get(nk)?.net === net || routed.attach.has(`${posKey(pos)}>${nk}`)) on |= 1 << side;
    });
    if (laneIds.has(net) && laneCells.has(posKey(pos))) on |= (1 << 4) | (1 << 5);
    return { pos, key: byId.get(net)!.conduit, net, manualMask: { forcedOn: on, forcedOff: 63 & ~on } };
  });
}

export const unitBlock = (u: Placed): PlacedBlock => ({
  pos: u.pos, key: u.key,
  ...(u.role ? { role: u.role } : {}),
  ...(u.port ? { port: u.port } : {}),
  ...(u.transformer?.up ? { stepUp: true } : {}),
  ...(u.facing !== undefined ? { facing: u.facing } : {}),
  ...(u.mainFacing !== undefined ? { mainFacing: u.mainFacing } : {}),
});

/** GregTech basic machines get a front toward the walkway; generators, transformers and markers don't have one. */
export const withFront = (u: Placed): Placed =>
  u.pm && !u.pm.generator && !u.pm.multiblock && !u.transformer ? { ...u, mainFacing: u.pos[2] < 0 ? 3 : 2 } : u;

/** `localTransformers`: the most transformers stepping down to each voltage in any one region (that region's network). */
export function powerNets(plan: LinePlan, units: Unit[], localTransformers: Partial<Record<PowerTier, number>>, warnings: string[]): Net[] {
  const source = plan.power.source.tier;
  const sourceEut = plan.power.source.kind === 'outside'
    ? plan.power.source.eut
    : units.filter((u) => u.pm?.generator).reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
  // Voltages above the source are stepped up to: their networks carry what the machines at or above them use.
  const top = Math.max(TIERS.indexOf(source), ...units.filter((u) => u.tier && !u.pm?.generator).map((u) => TIERS.indexOf(u.tier!)));
  const usedFrom = (t: PowerTier) => units.filter((u) => !u.pm?.generator && u.tier && TIERS.indexOf(u.tier) >= TIERS.indexOf(t)).reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
  return TIERS.filter((t) => TIERS.indexOf(t) <= top).map((t) => {
    const amps = t === source
      ? sourceEut / VOLTAGE[t]
      : TIERS.indexOf(t) > TIERS.indexOf(source) ? usedFrom(t) / VOLTAGE[t] : (localTransformers[t] ?? 0) * 4;
    const cable = cableFor(t, Math.max(1, amps));
    if (cable.warning) warnings.push(cable.warning);
    return { id: `p:${t}`, kind: 'cable' as const, name: `${t} power`, conduit: cable.key, producers: new Set<string>(), consumers: new Set<string>(), tier: t, source: t === source };
  });
}

/** What each network in the blocks carries (local power networks keep their own ids, e.g. `p:LV:slice`). */
export function lineNetworks(blocks: PlacedBlock[], nets: Net[], plan: LinePlan): LineNetwork[] {
  const ids = [...new Set(blocks.map((b) => b.net).filter((x): x is string => !!x))];
  return ids.map((id) => {
    const n = nets.find((x) => x.id === id || id.startsWith(`${x.id}:`))!;
    if (n.kind === 'cable') {
      const flow = n.source ? (plan.power.source.kind === 'outside' ? plan.power.source.eut : undefined) : undefined;
      return { id, name: n.name, kind: 'power', tier: n.tier, conduit: n.conduit, ...(flow !== undefined ? { flow } : {}) };
    }
    const keys = n.parts?.map((p) => p.key) ?? [n.id.slice(2)];
    const flow = plan.networks.filter((p) => keys.includes(p.key)).reduce((s, p) => s + p.flow, 0);
    return { id, name: n.name, kind: n.kind === 'fluidPipe' ? 'fluid' : 'item', icon: keys[0], flow, conduit: n.conduit };
  });
}

/**
 * Markers with a front (drawers, the Super Tank) face away from their pipe, sideways: a Super Tank takes nothing in
 * through its front, and a drawer can't face up or down. Prefer the side opposite the pipe, then any open side.
 */
export function faceMarkers(blocks: PlacedBlock[]): PlacedBlock[] {
  const at = new Map(blocks.map((b) => [posKey(b.pos), b]));
  const kindAt = (c: Vec3) => { const b = at.get(posKey(c)); return b && CATALOG.get(b.key)?.kind; };
  return blocks.map((b) => {
    const entry = CATALOG.get(b.key);
    if (entry?.kind !== 'marker' || !entry.textures.front) return b;
    const piped = [0, 1, 2, 3, 4, 5].filter((s) => /Pipe|cable/.test(kindAt(addVec(b.pos, DIRS[s])) ?? ''));
    const sides = [...piped.map((s) => OPPOSITE[s]), 2, 3, 4, 5].filter((s) => s >= 2 && !piped.includes(s));
    const facing = sides.find((s) => !kindAt(addVec(b.pos, DIRS[s]))) ?? sides[0];
    return facing === undefined ? b : { ...b, facing: facing as Facing };
  });
}

export function assemble(name: string, plan: LinePlan, blocks: PlacedBlock[], covers: FaceSetting[], notes: string[], generated?: GeneratedLine, nets: Net[] = []): Build {
  blocks = faceMarkers(blocks);
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
    ...(nets.length ? { networks: lineNetworks(blocks, nets, plan) } : {}),
  };
}

/**
 * Core machines one high in a row on one side of the walkway (so loops between them never cross it), every other
 * column; each transformer goes in the column next to a machine of its lower voltage, which takes power straight from it.
 */
export function placeCore(units: Unit[], coreStart: number, length: number, side: (u: Unit) => -1 | 1): Placed[] {
  const machines = units.filter((u) => !u.transformer);
  const placed: Placed[] = machines.map((u, i) => ({ ...u, pos: [coreStart + 1 + 2 * i, 0, side(u)] }));
  const taken = new Set(placed.map((p) => posKey(p.pos)));
  for (const t of units.filter((u) => u.transformer)) {
    const host = placed.find((m) => m.tier === t.transformer!.to && !m.transformer && !taken.has(posKey([m.pos[0] + 1, 0, m.pos[2]])) && m.pos[0] + 1 < coreStart + length);
    let pos: Vec3 | undefined = host ? [host.pos[0] + 1, 0, host.pos[2]] : undefined;
    for (let x = coreStart + 1; !pos && x < coreStart + length; x++) {
      for (const z of [-1, 1]) if (!pos && !taken.has(posKey([x, 0, z]))) pos = [x, 0, z];
    }
    if (!pos) pos = [coreStart, 0, -1];
    taken.add(posKey(pos));
    placed.push({ ...t, pos });
  }
  return placed;
}
