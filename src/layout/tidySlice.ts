import { CATALOG } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
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
export interface TidyOptions {
  /** Service columns per slice (more room for joins, a longer slice). */
  serviceWidth?: number;
  /** One slice with the core at x < 0 (a straight line): runs that reach x = 0 are joined by the core. */
  straight?: boolean;
  /** Join power (side-to-side bridges, the feed) in the service column before the pipes, so it gets the room. */
  powerFirst?: boolean;
}

export function tidySlice(arr: Arrangement, nets: Net[], plan: LinePlan, opts: TidyOptions = {}): TidySlice | { fail: string } {
  const { serviceWidth = 1, straight = false, powerFirst = false } = opts;
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

  // Power. A slice with generators powers itself: each generator pushes straight into the power run between the rows
  // (through a transformer in it when the machines run a voltage lower). Without generators, a feed from the core runs
  // at z = 3 or -3, behind everything, with a one-block stub to each transformer. Nothing of a higher voltage ever
  // touches a lower voltage's cable.
  const source = plan.power.source.tier;
  const si = TIERS.indexOf(source);
  const consumers = units.filter((u) => u.pm && !u.pm.generator && !u.pm.multiblock && u.tier);
  const gens = units.filter((u) => u.pm?.generator);
  const goods = nets.filter((n) => n.kind !== 'cable');
  const lowest = Math.min(si, ...consumers.map((u) => TIERS.indexOf(u.tier!)));
  let supply: PowerTier = gens.length ? tierOf(gens[0].pm) ?? source : source;
  if (!gens.length && lowest < si - 1) {
    supply = TIERS[si - 1]; // the core steps HV down to MV for the feed
    if (lowest < si - 2) return fail('machines three voltages below the source');
  }
  const localPower = new Map<string, Net>();
  const powerNet = (tier: PowerTier, id: string, amps: number): Net => {
    const base = nets.find((n) => n.id === `p:${tier}`) ?? nets.find((n) => n.kind === 'cable')!;
    const prev = localPower.get(id);
    const need = Math.max(amps, prev ? CATALOG.get(prev.conduit)!.cable!.ampsPerSize * CATALOG.get(prev.conduit)!.cable!.size : 1);
    const net: Net = { ...base, id, name: `${tier} power`, tier, source: false, conduit: cableFor(tier, need).key };
    localPower.set(id, net);
    return net;
  };
  const feedId = `p:${supply}`;
  const belowSource = TIERS.slice(0, si).reduce((s, t) => s + (plan.power.demand[t] ?? 0), 0);
  const given = nets.find((n) => n.id === feedId);
  const feedNet: Net | undefined = gens.length || !given
    ? undefined
    : supply === source ? given : { ...given, conduit: cableFor(supply, Math.max(1, belowSource / VOLTAGE[supply])).key };
  if (!gens.length && consumers.length && !feedNet) return fail(`no ${supply} power network`);
  const transformerKey = (from: PowerTier) => (from === 'MV' ? 'transformer_mv_lv' : 'transformer_hv_mv');
  const addTransformer = (pos: Vec3, from: PowerTier, to: PowerTier, facing: Facing) => {
    const key = transformerKey(from);
    const t: Placed = { role: `xf:${from}-${to}`, key, name: CATALOG.get(key)!.name, transformer: { from, to }, tier: to, pos, facing };
    units.push(t);
    unitAt.set(posKey(pos), t);
  };

  // Output and input runs, one cell per machine; anything beyond the first of each is an extra face. Generators face
  // the power run instead (their output goes nowhere else).
  const extras: { u: Placed; net: Net; out: boolean }[] = [];
  for (const u of units) {
    const [x, y, side] = u.pos;
    if (u.pm!.generator) {
      if (tierOf(u.pm) !== supply) return fail('generators of different voltages in one slice');
      u.facing = y === 0 ? 1 : 0;
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

  // Power runs: one per side at its machines' voltage, sandwiched between the rows.
  const sideTier = new Map<number, PowerTier>();
  for (const side of [-1, 1]) {
    const here = consumers.filter((u) => u.pos[2] === side);
    if (here.length) sideTier.set(side, here[0].tier!);
    else if (gens.some((g) => g.pos[2] === side)) sideTier.set(side, consumers[0]?.tier ?? supply);
  }
  // A side with machines but no generators of its own takes power across the service column (same voltage only).
  const bridge = gens.length > 0 && [-1, 1].some((side) => consumers.some((u) => u.pos[2] === side) && !gens.some((g) => g.pos[2] === side));
  if (bridge && new Set(sideTier.values()).size > 1) return fail('one side has no generators and runs a different voltage from the other');
  const feedStubs: Vec3[] = [];
  for (const [side, tier] of sideTier) {
    const step = TIERS.indexOf(supply) - TIERS.indexOf(tier);
    if (step < 0 || step > 1) return fail(`${tier} machines two voltages below the ${supply} supply`);
    const here = consumers.filter((u) => u.pos[2] === side);
    const transformerAt = new Map<number, Facing>(); // x -> the transformer's input face
    const genAt = new Map<number, Placed>();
    if (gens.length) {
      for (const g of gens.filter((x) => x.pos[2] === side)) {
        if (genAt.has(g.pos[0])) return fail('two generators would push into one power-run block');
        genAt.set(g.pos[0], g);
        if (step === 1) transformerAt.set(g.pos[0], g.pos[1] === 0 ? 0 : 1);
      }
    } else if (step === 1) {
      const demand = here.reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
      const count = Math.ceil(demand / (VOLTAGE[tier] * 4) - 1e-9);
      if (count > C) return fail(`${count} transformers don't fit in one power run`);
      for (let i = 0; i < count; i++) transformerAt.set(Math.floor(((i + 0.5) * C) / count), side < 0 ? 2 : 3);
    }
    const amps = step === 1 ? 4 * Math.max(transformerAt.size, gens.length) : Math.max(1, gens.length);
    const id = step === 0 && feedNet ? feedNet.id : bridge || step === 0 ? `p:${tier}:slice` : `p:${tier}:slice${side < 0 ? 'N' : 'S'}`;
    const run = id === feedNet?.id ? feedNet : powerNet(tier, id, amps);
    for (let x = 0; x < C; x++) {
      const pos: Vec3 = [x, 1, side];
      const input = transformerAt.get(x);
      if (input !== undefined) {
        addTransformer(pos, supply, tier, input);
        if (!gens.length) feedStubs.push([x, 1, 2 * side]);
        continue;
      }
      if (!put(pos, run.id)) return fail('no room for the power run');
      for (const y of [0, 2]) {
        const m = unitAt.get(posKey([x, y, side]));
        if (m && consumers.includes(m)) serve(pos, m);
      }
      const g = genAt.get(x);
      if (g) serve(pos, g); // a generator at the run's voltage pushes straight into it
    }
    for (let x = 0; x < C; x++) {
      if (transformerAt.has(x)) continue;
      for (const dx of [-1, 1]) {
        const t = unitAt.get(posKey([x + dx, 1, side]));
        if (t?.transformer) serve([x, 1, side], t);
      }
    }
    // Machines at the supply voltage with no generators here: a feed stub joins their run.
    if (!gens.length && step === 0) feedStubs.push([0, 1, 2 * side]);
  }
  // The feed from the core (slices without generators): along z = 3 or -3, a stub to each transformer or run.
  if (feedNet) {
    for (const side of new Set(feedStubs.map((c) => Math.sign(c[2])))) {
      for (let x = 0; x < L; x++) if (!put([x, 1, 3 * side], feedNet.id)) return fail('no room for the power feed');
    }
    for (const stub of feedStubs) {
      const side = Math.sign(stub[2]);
      if (!put(stub, feedNet.id)) return fail('no room for a feed stub');
      const t = unitAt.get(posKey([stub[0], 1, side]));
      if (t?.transformer) serve(stub, t);
      else link(stub, [stub[0], 1, side]);
      link(stub, [stub[0], 1, 3 * side]);
    }
  }

  // Through-runs: every run of a network the core or other slices need carries on straight across the whole slice
  // (into the next slice and the core, which joins them), so slices only join their own local runs.
  const allNets = [...goods, ...(feedNet ? [feedNet] : []), ...localPower.values()];
  const byId = new Map(allNets.map((n) => [n.id, n]));
  const throughRuns = new Map<string, Vec3[][]>();
  const slotFree = (y: number, z: number, net: string) =>
    Array.from({ length: L }, (_, x) => posKey([x, y, z])).every((k) => !unitAt.has(k) && (!cellNet.has(k) || cellNet.get(k) === net));
  const spare: [number, number][] = [[-1, -2], [-1, 2], [3, -2], [3, 2], ...[-1, 0, 1, 2, 3].flatMap((y) => [[y, -3], [y, 3]] as [number, number][])];
  const used = (id: string) => [...cellNet.values()].includes(id);
  const spans = (n: Net) => n.kind === 'cable' ? n.id === feedNet?.id : [...n.producers, ...n.consumers].some((r) => !sliceRoles.has(r));
  // A straight line has one slice with the core at x < 0: any run that can carry on straight to x = 0 is joined by
  // the core, even one only this slice uses (a run stuck behind other machines in its row can't reach the service column).
  if (straight) {
    for (const n of allNets) {
      if (!used(n.id) || (n.kind === 'cable' && n.id !== feedId)) continue;
      const slots = new Map<string, { y: number; z: number; xs: number[] }>();
      for (const [k, id] of cellNet) {
        if (id !== n.id) continue;
        const [x, y, z] = cellPos.get(k)!;
        if (n.kind === 'cable' && y !== 1) continue;
        const slot = slots.get(`${y},${z}`) ?? { y, z, xs: [] };
        slot.xs.push(x);
        slots.set(`${y},${z}`, slot);
      }
      const runs: Vec3[][] = [];
      for (const { y, z, xs } of slots.values()) {
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        const toZero = Array.from({ length: lo }, (_, x): Vec3 => [x, y, z]);
        if (!toZero.every((c) => !unitAt.has(posKey(c)) && (!cellNet.has(posKey(c)) || cellNet.get(posKey(c)) === n.id))) continue;
        for (const c of toZero) put(c, n.id);
        runs.push(Array.from({ length: hi + 1 }, (_, x): Vec3 => [x, y, z]));
      }
      if (runs.length) throughRuns.set(n.id, runs);
    }
  }
  for (const n of allNets) {
    if (!used(n.id) || !spans(n) || throughRuns.has(n.id)) continue;
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
  // A cable may not run beside a cable of another voltage, nor beside a power output of a higher one (burn risk when
  // built by hand: GT cables join whatever they're placed against).
  const keepApart = (id: string): Set<string> => {
    const out = new Set<string>();
    const tier = byId.get(id)?.tier;
    if (!tier || byId.get(id)?.kind !== 'cable') return out;
    const around = (c: Vec3) => DIRS.forEach((d) => out.add(posKey(addVec(c, d))));
    for (const [k, n] of cellNet) {
      const other = byId.get(n);
      if (other?.kind === 'cable' && other.tier !== tier) around(cellPos.get(k)!);
    }
    for (const u of unitAt.values()) {
      if (u.transformer && TIERS.indexOf(u.transformer.to) > TIERS.indexOf(tier)) around(u.pos);
      if (u.pm?.generator && u.facing !== undefined && TIERS.indexOf(supply) > TIERS.indexOf(tier)) out.add(posKey(addVec(u.pos, DIRS[u.facing])));
    }
    return out;
  };
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
          let nk = posKey(addVec(p, d));
          // A transformer in a power run gives its voltage on both sides, so it joins the run's cells either side.
          const t = unitAt.get(nk);
          if (side >= 4 && t?.transformer && t.transformer.to === byId.get(id)?.tier) nk = posKey(addVec(addVec(p, d), d));
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
    const tier = byId.get(id)?.kind === 'cable' ? byId.get(id)?.tier : undefined;
    const besideTransformers = (comp: Vec3[]): Vec3[] => !tier ? [] : comp.flatMap((p) => [4, 5].flatMap((side) => {
      const t = unitAt.get(posKey(addVec(p, DIRS[side])));
      if (!t?.transformer || t.transformer.to !== tier) return [];
      const beyond = addVec(t.pos, DIRS[side]);
      return !unitAt.has(posKey(beyond)) && !cellNet.has(posKey(beyond)) && !blocked.has(posKey(beyond)) ? [beyond] : [];
    }));
    const local = components(id).filter((c) => !c.some((p) => runCells.has(posKey(p)))).map((c) => [...c, ...besideTransformers(c)]);
    const terminals = [...extra, ...(runs.length ? [runs.flat()] : []), ...local];
    if (terminals.length < 2) return [];
    const others = new Set(blocked);
    for (const [k, n] of cellNet) if (n !== id) others.add(k);
    for (const k of keepApart(id)) others.add(k);
    try {
      const res = routeNetwork({ terminals, blocked: others, bounds, canStep, bendPenalty: BEND_PENALTY });
      for (const c of res.cells) put(c, id);
      return res.chosen;
    } catch {
      return fail(`no room to join the ${byId.get(id)?.name ?? id} runs`);
    }
  };
  const goodsOrder = [
    ...goods.filter((n) => used(n.id) && !throughRuns.has(n.id)),
    ...goods.filter((n) => throughRuns.has(n.id)),
  ];
  // Power runs fed by their own transformers need no joining; a side without generators is bridged to the other.
  const powerOrder = [
    ...[...localPower.values()].filter((n) => bridge && n.id.endsWith(':slice')),
    ...(feedNet && used(feedNet.id) ? [feedNet] : []),
  ];
  // Bridging the two sides' feeds in the service column saves the power for one side going all the way round through
  // the core; first (taking room from pipes) when asked, else only if there's room left.
  const bridgeFeeds = () => {
    const feeds = throughRuns.get(feedId) ?? [];
    if (feeds.length < 2) return true;
    const others = new Set(blocked);
    for (const [k, n] of cellNet) if (n !== feedId) others.add(k);
    for (const k of keepApart(feedId)) others.add(k);
    try {
      const res = routeNetwork({ terminals: feeds, blocked: others, bounds, canStep, bendPenalty: BEND_PENALTY });
      for (const c of res.cells) put(c, feedId);
      return true;
    } catch {
      return false;
    }
  };
  // Power joins first (taking room from pipes) when asked, else after the pipes.
  for (const n of powerFirst ? [...powerOrder, ...goodsOrder] : [...goodsOrder, ...powerOrder]) {
    const r = join(n.id);
    if ('fail' in r) return r;
  }
  if (powerFirst && !bridgeFeeds()) return fail('no room to bridge the power feeds');
  if (!powerFirst) bridgeFeeds();

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
      const t = unitAt.get(nk);
      if (t?.transformer && t.transformer.to === byId.get(net)?.tier && OPPOSITE[side] !== t.facing) on |= 1 << side;
    });
    if (through.has(k)) {
      if (pos[0] === 0) on |= 1 << 4;
      if (pos[0] === L - 1) on |= 1 << 5;
    }
    return { pos, key: byId.get(net)!.conduit, net, manualMask: { forcedOn: on, forcedOff: 63 & ~on } };
  });

  return { length: L, serviceFrom: C, blocks: [...units.map(unitBlock), ...conduits], routed, throughRuns, nets: allNets };
}
