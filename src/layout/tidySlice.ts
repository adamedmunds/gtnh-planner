import { CATALOG } from '../catalog';
import { DIRS, addVec, posKey } from '../model/directions';
import { routeNetwork } from '../model/route';
import type { Facing, PlacedBlock, Vec3 } from '../model/types';
import { VOLTAGE, cableFor } from './power';
import { SIDE_NAME, TIERS, itemFilters, sideTo, tierOf, unitBlock, withFront, type Net, type Placed, type Routed } from './region';
import { ROWS, type Arrangement } from './tidyRows';
import type { LinePlan, PowerTier } from './types';

/** The tidy cross-section's bounds (y and |z|); x is the slice's own. */
export const TIDY_BOUNDS = { yMin: -1, yMax: 3, zMax: 3 };
/** Bends in a crossover cost this much extra, so crossovers come out as straight risers and bridges. */
const BEND_PENALTY = 2;

export interface TidySlice {
  /** Machine columns, then the service column(s). */
  length: number;
  /** x of the first service column (the rest of the slice is machine columns). */
  serviceFrom: number;
  /** Machines, transformers and conduits, relative to the slice's x = 0. */
  blocks: PlacedBlock[];
  /** Conduit cells, attachments, covers and notes (for filters, labels and notes). */
  routed: Routed;
  /** Networks other slices or the core need: their straight runs across the whole slice (the core joins them). */
  throughRuns: Map<string, Vec3[][]>;
  /** Every network the slice uses, including its local power networks. */
  nets: Net[];
}

const fail = (why: string) => ({ fail: why });

/**
 * One slice in the tidy cross-section: machines in their rows facing the walkway, output runs behind the rows, input
 * runs under the lower and over the upper row, a power run sandwiched between the rows with step-down transformers in
 * it, the power feed behind that, and runs of one network joined only in the service column.
 */
export function tidySlice(arr: Arrangement, nets: Net[], plan: LinePlan, serviceWidth = 1): TidySlice | { fail: string } {
  const C = arr.columns;
  const L = C + serviceWidth;
  const svc = (x: number) => x >= C;
  const units: Placed[] = [];
  const unitAt = new Map<string, Placed>();
  const cellNet = new Map<string, string>();
  const cellPos = new Map<string, Vec3>();
  const links = new Set<string>(); // `${a}|${b}`: cable-to-cable links straight across to the power feed
  const routed: Routed = { cells: new Map(), attach: new Set(), ends: [], covers: [], notes: [] };
  const put = (pos: Vec3, net: string) => {
    const k = posKey(pos);
    if (unitAt.has(k) || (cellNet.has(k) && cellNet.get(k) !== net)) return false;
    cellNet.set(k, net);
    cellPos.set(k, pos);
    return true;
  };
  const serve = (cell: Vec3, u: Placed) => {
    routed.attach.add(`${posKey(cell)}>${posKey(u.pos)}`);
    routed.ends.push({ net: cellNet.get(posKey(cell))!, cell, unit: u });
  };
  const link = (a: Vec3, b: Vec3) => {
    links.add(`${posKey(a)}|${posKey(b)}`);
    links.add(`${posKey(b)}|${posKey(a)}`);
  };
  const back = (side: number): Facing => (side < 0 ? 2 : 3);

  // Machines in their rows.
  for (const st of arr.stretches) {
    const { side, y } = ROWS[st.row];
    const m = st.machine;
    for (let x = st.x0; x < st.x0 + st.count; x++) {
      const u = withFront({ role: m.nodeId, key: m.key, name: CATALOG.get(m.key)?.name ?? m.machine.name, pm: m, tier: tierOf(m), pos: [x, y, side], facing: back(side) });
      units.push(u);
      unitAt.set(posKey(u.pos), u);
    }
  }
  const sliceRoles = new Set(units.map((u) => u.role));

  // Power: the feed runs at the source voltage, or one step lower when the core steps HV down first.
  const source = plan.power.source.tier;
  const si = TIERS.indexOf(source);
  const consumers = units.filter((u) => u.pm && !u.pm.generator && !u.pm.multiblock && u.tier);
  const lowest = Math.min(si, ...consumers.map((u) => TIERS.indexOf(u.tier!)));
  let feedTier: PowerTier = source;
  if (lowest < si - 1) {
    if (units.some((u) => u.pm?.generator)) return fail("generators in a slice can't feed machines two voltages below them");
    feedTier = TIERS[si - 1];
    if (lowest < si - 2) return fail('machines three voltages below the source');
  }
  const feedId = `p:${feedTier}`;
  const given = nets.find((n) => n.id === feedId);
  if (!given) return fail(`no ${feedTier} power network`);
  const belowSource = TIERS.slice(0, si).reduce((s, t) => s + (plan.power.demand[t] ?? 0), 0);
  const feedNet: Net = feedTier === source ? given : { ...given, conduit: cableFor(feedTier, Math.max(1, belowSource / VOLTAGE[feedTier])).key };
  const localPower = new Map<string, Net>();
  const goods = nets.filter((n) => n.kind !== 'cable');

  // Output and input runs, one cell per machine; anything beyond the first of each is an extra face.
  const extras: { u: Placed; net: Net; out: boolean }[] = [];
  const feedNeeded = new Set<number>();
  for (const u of units) {
    const [x, y, side] = u.pos;
    if (u.pm!.generator) {
      if (feedTier !== source) return fail('generators need the feed at their own voltage');
      const cell: Vec3 = [x, y, 2 * side];
      if (!put(cell, feedId)) return fail('no room behind a generator');
      serve(cell, u);
      link(cell, [x, 1, 2 * side]);
      feedNeeded.add(side);
      u.facingNet = feedId;
    } else {
      const outs = goods.filter((n) => n.producers.has(u.role));
      const out = outs.find((n) => n.kind === 'itemPipe') ?? outs[0];
      if (out) {
        const cell: Vec3 = [x, y, 2 * side];
        if (!put(cell, out.id)) return fail(`no room for the ${out.name} run`);
        serve(cell, u);
        u.facingNet = out.id;
      }
      for (const o of outs) if (o !== out) extras.push({ u, net: o, out: true });
    }
    const ins = goods.filter((n) => n.consumers.has(u.role));
    if (ins[0]) {
      const cell: Vec3 = [x, y === 0 ? -1 : 3, side];
      if (!put(cell, ins[0].id)) return fail(`no room for the ${ins[0].name} run`);
      serve(cell, u);
    }
    for (const i of ins.slice(1)) extras.push({ u, net: i, out: false });
  }

  // Power runs: sandwiched between the rows of each side, at that side's voltage, with transformers in them.
  for (const side of [-1, 1]) {
    const here = consumers.filter((u) => u.pos[2] === side);
    if (!here.length) continue;
    const tier = here[0].tier!;
    const demand = here.reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
    let runNet = feedNet;
    const transformerAt = new Set<number>();
    if (tier === feedTier) {
      for (let x = 0; x < C; x++) link([x, 1, side], [x, 1, 2 * side]);
    } else if (TIERS.indexOf(tier) === TIERS.indexOf(feedTier) - 1) {
      const count = Math.ceil(demand / (VOLTAGE[tier] * 4) - 1e-9);
      if (count > C) return fail(`${count} transformers don't fit in one power run`);
      for (let i = 0; i < count; i++) transformerAt.add(Math.floor(((i + 0.5) * C) / count));
      // Each side's run is its own network, fed by the transformers in it (they never touch the other side's).
      const id = `p:${tier}:slice${side < 0 ? 'N' : 'S'}`;
      const base = nets.find((n) => n.id === `p:${tier}`) ?? feedNet;
      runNet = { ...base, id, name: `${tier} power`, tier, source: false, conduit: cableFor(tier, count * 4).key };
      localPower.set(id, runNet);
    } else return fail(`${tier} machines two voltages below the ${feedTier} feed`);
    feedNeeded.add(side);
    for (let x = 0; x < C; x++) {
      const pos: Vec3 = [x, 1, side];
      if (transformerAt.has(x)) {
        const key = feedTier === 'MV' ? 'transformer_mv_lv' : 'transformer_hv_mv';
        const t: Placed = { role: `xf:${feedTier}-${tier}`, key, name: CATALOG.get(key)!.name, transformer: { from: feedTier, to: tier }, tier, pos, facing: back(side) };
        units.push(t);
        unitAt.set(posKey(pos), t);
        continue;
      }
      if (!put(pos, runNet.id)) return fail('no room for the power run');
      for (const y of [0, 2]) {
        const m = unitAt.get(posKey([x, y, side]));
        if (m && consumers.includes(m)) serve(pos, m);
      }
    }
    for (let x = 0; x < C; x++) {
      if (transformerAt.has(x)) continue;
      for (const dx of [-1, 1]) {
        const t = unitAt.get(posKey([x + dx, 1, side]));
        if (t?.transformer) serve([x, 1, side], t);
      }
    }
  }
  for (const side of feedNeeded) {
    for (let x = 0; x < C; x++) {
      const pos: Vec3 = [x, 1, 2 * side];
      if (!put(pos, feedId)) return fail('no room for the power feed');
      const t = unitAt.get(posKey([x, 1, side]));
      if (t?.transformer) serve(pos, t);
    }
  }

  // Through-runs: every run of a network the core or other slices need carries on straight across the whole slice
  // (into the next slice and the core, which joins them), so slices only join their own local runs.
  const allNets = [...goods, feedNet, ...localPower.values()];
  const byId = new Map(allNets.map((n) => [n.id, n]));
  const throughRuns = new Map<string, Vec3[][]>();
  const slotFree = (y: number, z: number, net: string) =>
    Array.from({ length: L }, (_, x) => posKey([x, y, z])).every((k) => !unitAt.has(k) && (!cellNet.has(k) || cellNet.get(k) === net));
  const spare: [number, number][] = [[-1, -2], [-1, 2], [3, -2], [3, 2], ...[-1, 0, 1, 2, 3].flatMap((y) => [[y, -3], [y, 3]] as [number, number][])];
  const used = (id: string) => [...cellNet.values()].includes(id);
  const spans = (n: Net) => n.kind === 'cable' ? n.id === feedId : [...n.producers, ...n.consumers].some((r) => !sliceRoles.has(r));
  for (const n of allNets) {
    if (!used(n.id) || !spans(n)) continue;
    const own = new Map<string, [number, number]>();
    for (const [k, id] of cellNet) if (id === n.id) own.set(`${cellPos.get(k)![1]},${cellPos.get(k)![2]}`, [cellPos.get(k)![1], cellPos.get(k)![2]]);
    // Power carries on only along the feed; generator backs stay one-block links down/up to it.
    const slots = [...own.values()].filter(([y, z]) => (n.kind !== 'cable' || y === 1) && slotFree(y, z, n.id));
    if (!slots.length) {
      const spareSlot = spare.find(([y, z]) => slotFree(y, z, n.id));
      if (!spareSlot) return fail(`no straight run left for ${n.name}`);
      slots.push(spareSlot);
    }
    const runs = slots.map(([y, z]) => Array.from({ length: L }, (_, x): Vec3 => [x, y, z]));
    for (const c of runs.flat()) put(c, n.id);
    throughRuns.set(n.id, runs);
  }

  // Join the runs of each network, only inside the service column.
  const blocked = new Set<string>(unitAt.keys());
  for (let x = 0; x < L; x++) {
    blocked.add(posKey([x, -1, 0]));
    for (let y = 0; y <= TIDY_BOUNDS.yMax; y++) if (y <= 1 || !svc(x)) blocked.add(posKey([x, y, 0]));
  }
  const canStep = (a: Vec3, b: Vec3) => a[0] !== b[0] || svc(a[0]);
  const bounds = { min: [0, TIDY_BOUNDS.yMin, -TIDY_BOUNDS.zMax] as Vec3, max: [L - 1, TIDY_BOUNDS.yMax, TIDY_BOUNDS.zMax] as Vec3 };
  const components = (id: string): Vec3[][] => {
    const cells = [...cellNet].filter(([, n]) => n === id).map(([k]) => k);
    const seen = new Set<string>();
    const out: Vec3[][] = [];
    for (const start of cells) {
      if (seen.has(start)) continue;
      const comp: Vec3[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const k = stack.pop()!;
        const p = cellPos.get(k)!;
        comp.push(p);
        DIRS.forEach((d, side) => {
          const nk = posKey(addVec(p, d));
          if (seen.has(nk) || cellNet.get(nk) !== id) return;
          if (side < 4 && !svc(p[0]) && !links.has(`${k}|${nk}`)) return;
          seen.add(nk);
          stack.push(nk);
        });
      }
      out.push(comp);
    }
    return out;
  };
  const join = (id: string, extra: Vec3[][] = []): Vec3[] | { fail: string } => {
    // Through-runs are joined in the core, so together they count as one end here.
    const runs = throughRuns.get(id) ?? [];
    const runCells = new Set(runs.flat().map(posKey));
    const local = components(id).filter((c) => !c.some((p) => runCells.has(posKey(p))));
    const terminals = [...extra, ...(runs.length ? [runs.flat()] : []), ...local];
    if (terminals.length < 2) return [];
    const others = new Set(blocked);
    for (const [k, n] of cellNet) if (n !== id) others.add(k);
    try {
      const res = routeNetwork({ terminals, blocked: others, bounds, canStep, bendPenalty: BEND_PENALTY });
      for (const c of res.cells) put(c, id);
      return res.chosen;
    } catch {
      return fail(`no room to join the ${byId.get(id)?.name ?? id} runs`);
    }
  };
  const order = [
    ...goods.filter((n) => used(n.id) && !throughRuns.has(n.id)),
    ...goods.filter((n) => throughRuns.has(n.id)),
    // Local power runs need no joining: every stretch of one lies next to a transformer in it.
    ...(used(feedNet.id) ? [feedNet] : []),
  ];
  for (const n of order) {
    const r = join(n.id);
    if ('fail' in r) return r;
  }

  // Second inputs and outputs: a free face beside the machine, joined like any other run.
  for (const { u, net, out } of extras) {
    const faces = [-1, 1]
      .map((dx): Vec3 => [u.pos[0] + dx, u.pos[1], u.pos[2]])
      .filter((c) => c[0] >= 0 && c[0] < L && !unitAt.has(posKey(c)) && (!cellNet.has(posKey(c)) || cellNet.get(posKey(c)) === net.id));
    if (!faces.length) return fail(`no free face on the ${u.name} for ${net.name}`);
    let cell = faces[0];
    if (!used(net.id)) put(cell, net.id);
    else {
      const r = join(net.id, [faces]);
      if ('fail' in r) return r;
      cell = r[0];
    }
    serve(cell, u);
    if (out) {
      const side = sideTo(u.pos, cell);
      const kind = net.kind === 'fluidPipe' ? 'pump' : 'conveyor';
      routed.covers.push({ pos: u.pos, side, kind });
      routed.notes.push(`Put a ${kind} cover on the ${SIDE_NAME[side]} of the ${u.name} at (${u.pos.join(', ')}), set to export, so ${net.name} goes into its own pipe.`);
    }
  }
  itemFilters(routed, allNets);

  // Conduits connect along their run, to the blocks they serve, across to the feed, and freely in the service column.
  const through = new Set([...throughRuns.values()].flat(2).map(posKey));
  const conduits: PlacedBlock[] = [...cellNet].map(([k, net]) => {
    const pos = cellPos.get(k)!;
    routed.cells.set(k, { pos, net });
    let on = 0;
    DIRS.forEach((d, side) => {
      const nk = posKey(addVec(pos, d));
      const same = cellNet.get(nk) === net;
      if (same && (side >= 4 || svc(pos[0]) || links.has(`${k}|${nk}`))) on |= 1 << side;
      if (routed.attach.has(`${k}>${nk}`)) on |= 1 << side;
    });
    if (through.has(k)) {
      if (pos[0] === 0) on |= 1 << 4;
      if (pos[0] === L - 1) on |= 1 << 5;
    }
    return { pos, key: byId.get(net)!.conduit, net, manualMask: { forcedOn: on, forcedOff: 63 & ~on } };
  });

  return { length: L, serviceFrom: C, blocks: [...units.map(unitBlock), ...conduits], routed, throughRuns, nets: allNets };
}
