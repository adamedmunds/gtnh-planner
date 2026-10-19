import { CATALOG } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import { routeNetwork } from '../model/route';
import type { Facing, PlacedBlock, Vec3 } from '../model/types';
import { VOLTAGE, cableFor } from './power';
import { SIDE_NAME, TIERS, itemFilters, sideTo, tierOf, unitBlock, type Net, type Placed, type Routed } from './region';
import { ROWS, type Arrangement } from './tidyRows';
import type { LinePlan, PowerTier } from './types';

/**
 * The tidy cross-section (no walkway): the north machine column at z = 0 and the south one at z = 1, touching, fronts
 * facing each other; output runs on the outer backs (z = -1 and 2); spare runs further out (z = -2 and 3).
 */
export const TIDY_BOUNDS = { yMin: -1, yMax: 3, zMin: -2, zMax: 3 };
/** z of a cell `depth` blocks out from the middle on `side` (north -1, south +1): 1 machines, 2 outputs, 3 spare. */
export const tidyZ = (side: number, depth: number) => (side < 0 ? 1 - depth : depth);
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
  /** Gap columns (beside machines that need a side face), where pipes may turn like in the service column. */
  gaps?: number[];
}

export interface TidyOptions {
  /** Service columns per slice (more room for joins, a longer slice). */
  serviceWidth?: number;
  /** One slice with the core at x < 0 (a straight line): runs that reach x = 0 are joined by the core. */
  straight?: boolean;
  /** Join the power feed in the service column before the pipes, so it gets the room. */
  powerFirst?: boolean;
  /** How many copies of the slice the line has (to share each machine group's average use out per machine). */
  copies?: number;
  /** Let joins turn anywhere along the slice, not only in service and gap columns (for lines too dense otherwise). */
  relaxed?: boolean;
}

const fail = (why: string) => ({ fail: why });

/**
 * One slice in the tidy cross-section: two columns of machines in two rows, fronts facing each other; output runs on
 * the outer backs, input runs under the lower and over the upper row, and one power layer between the rows across both
 * columns. A generator in a row pushes straight into a transformer above or below it in the power layer, which feeds
 * the machines it touches and, through the layer's cables, the rest. Runs of one network are joined only in the service
 * column; runs the core or other slices need carry straight through.
 */
export function tidySlice(arr: Arrangement, nets: Net[], plan: LinePlan, opts: TidyOptions = {}): TidySlice | { fail: string } {
  const { serviceWidth = 1, straight = false, powerFirst = false, copies = 1, relaxed = false } = opts;
  const C = arr.columns;
  const L = C + serviceWidth;
  // Pipes leave a straight run only in the service column, or in a gap column beside a machine that needs a side face.
  const gapCols = new Set(arr.gaps ?? []);
  const svc = (x: number) => x >= C || gapCols.has(x);
  const sideOf = (z: number) => (z <= 0 ? -1 : 1);
  const units: Placed[] = [];
  const unitAt = new Map<string, Placed>();
  const cellNet = new Map<string, string>();
  const cellPos = new Map<string, Vec3>();
  const links = new Set<string>(); // `${a}|${b}`: cable-to-cable links outside the service column
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
  const outward = (side: number): Facing => (side < 0 ? 2 : 3);
  const inward = (side: number): Facing => (side < 0 ? 3 : 2);

  // Machines in their rows: fronts toward the other column, outputs out the back.
  for (const st of arr.stretches) {
    const { side, y } = ROWS[st.row];
    const m = st.machine;
    for (let x = st.x0; x < st.x0 + st.count; x++) {
      const u: Placed = { role: m.nodeId, key: m.key, name: CATALOG.get(m.key)?.name ?? m.machine.name, pm: m, tier: tierOf(m), pos: [x, y, tidyZ(side, 1)], facing: outward(side) };
      if (!m.generator && !m.multiblock) u.mainFacing = inward(side);
      units.push(u);
      unitAt.set(posKey(u.pos), u);
    }
  }
  const sliceRoles = new Set(units.map((u) => u.role));

  // Power. With generators the slice powers itself; without, a feed from the core runs along the outside (z = -2 or 3)
  // with a one-block stub to each transformer. Nothing of a higher voltage ever touches a lower voltage's cable.
  const source = plan.power.source.tier;
  const si = TIERS.indexOf(source);
  const consumers = units.filter((u) => u.pm && !u.pm.generator && !u.pm.multiblock && u.tier);
  const gens = units.filter((u) => u.pm?.generator);
  const goods = nets.filter((n) => n.kind !== 'cable');
  const tiersUsed = new Set(consumers.map((u) => u.tier!));
  if (tiersUsed.size > 1) return fail('machines of two voltages would share one power layer');
  const tier: PowerTier | undefined = consumers[0]?.tier;
  let supply: PowerTier = gens.length ? tierOf(gens[0].pm) ?? source : source;
  if (!gens.length && tier && TIERS.indexOf(tier) < si - 1) {
    supply = TIERS[si - 1]; // the core steps HV down to MV for the feed
    if (TIERS.indexOf(tier) < si - 2) return fail('machines three voltages below the source');
  }
  if (gens.some((g) => tierOf(g.pm) !== supply)) return fail('generators of different voltages in one slice');
  const step = tier ? TIERS.indexOf(supply) - TIERS.indexOf(tier) : 0;
  if (step < 0 || step > 1) return fail(`${tier} machines two voltages below the ${supply} supply`);
  const feedId = `p:${supply}`;
  const belowSource = TIERS.slice(0, si).reduce((s, t) => s + (plan.power.demand[t] ?? 0), 0);
  const given = nets.find((n) => n.id === feedId);
  const feedNet: Net | undefined = gens.length || !given || !consumers.length
    ? undefined
    : supply === source ? given : { ...given, conduit: cableFor(supply, Math.max(1, belowSource / VOLTAGE[supply])).key };
  if (!gens.length && consumers.length && !feedNet) return fail(`no ${supply} power network`);

  // Enough generators for what the machines use on average, and enough transformers (4 A each) for one amp a machine.
  const avg = (u: Placed) => (u.pm!.avgEut ?? u.pm!.eut * u.pm!.count * copies) / (u.pm!.count * copies);
  const genEut = gens[0]?.pm?.eut ?? 0;
  if (gens.length && consumers.reduce((s, u) => s + avg(u), 0) > gens.length * genEut + 1e-9) return fail('not enough generators');
  if (gens.length && step === 1 && consumers.length > 4 * gens.length) return fail('more machines than the transformers can feed');

  // Output and input runs, one cell per machine; anything beyond the first of each is an extra face. Generators face
  // the power layer instead (their output goes nowhere else).
  const extras: { u: Placed; net: Net; out: boolean }[] = [];
  for (const u of units) {
    const [x, y, z] = u.pos;
    const side = sideOf(z);
    if (u.pm!.generator) u.facing = y === 0 ? 1 : 0;
    else {
      const outs = goods.filter((n) => n.producers.has(u.role));
      const out = outs.find((n) => n.kind === 'itemPipe') ?? outs[0];
      if (out) {
        const cell: Vec3 = [x, y, tidyZ(side, 2)];
        if (!put(cell, out.id)) return fail(`no room for the ${out.name} run`);
        serve(cell, u);
        u.facingNet = out.id;
      }
      for (const o of outs) if (o !== out) extras.push({ u, net: o, out: true });
    }
    const ins = goods.filter((n) => n.consumers.has(u.role));
    if (ins[0]) {
      const cell: Vec3 = [x, y === 0 ? -1 : 3, z];
      if (!put(cell, ins[0].id)) return fail(`no room for the ${ins[0].name} run`);
      serve(cell, u);
    }
    for (const i of ins.slice(1)) extras.push({ u, net: i, out: false });
  }

  // The power layer: both columns between the rows. Transformers sit right against their generators (or, fed from the
  // core, spread out with their inputs facing out to the feed stubs); cables fill the rest and get trimmed below.
  const transformerKey = (from: PowerTier) => (from === 'MV' ? 'transformer_mv_lv' : 'transformer_hv_mv');
  const localPower = new Map<string, Net>();
  const feedStubs: Vec3[] = [];
  let layerNet: Net | undefined;
  if (tier || gens.length) {
    const layerTier = tier ?? supply;
    const transformers = new Map<string, Facing>(); // layer cell -> the transformer's input face
    const genAt = new Map<string, Placed>();
    for (const g of gens) {
      const cell = posKey([g.pos[0], 1, g.pos[2]]);
      if (genAt.has(cell)) return fail('two generators would push into one power-layer block');
      genAt.set(cell, g);
      if (step === 1) transformers.set(cell, g.pos[1] === 0 ? 0 : 1);
    }
    if (!gens.length && step === 1) {
      const demand = consumers.reduce((s, u) => s + (u.pm?.eut ?? 0), 0);
      const count = Math.ceil(demand / (VOLTAGE[layerTier] * 4) - 1e-9);
      if (count > 2 * C) return fail(`${count} transformers don't fit in the power layer`);
      // Spread evenly along both columns, inputs facing out to their feed stubs.
      [Math.ceil(count / 2), Math.floor(count / 2)].forEach((n, i) => {
        const side = i ? 1 : -1;
        for (let k = 0; k < n; k++) transformers.set(posKey([Math.floor(((k + 0.5) * C) / n), 1, tidyZ(side, 1)]), outward(side));
      });
    }
    // A block of the layer carries at most one transformer's 4 A (each feeds the machines next to it); straight from
    // generators, at most what they all push in.
    const amps = step === 1 ? 4 : Math.max(1, gens.length);
    layerNet = step === 0 && feedNet ? feedNet : (() => {
      const base = nets.find((n) => n.id === `p:${layerTier}`) ?? nets.find((n) => n.kind === 'cable')!;
      const net: Net = { ...base, id: `p:${layerTier}:slice`, name: `${layerTier} power`, tier: layerTier, source: false, conduit: cableFor(layerTier, amps).key };
      localPower.set(net.id, net);
      return net;
    })();
    // Fed from the core at the machines' own voltage, the layer goes only where a machine sits above or below (gaps stay
    // free for pipes rising from side faces); each piece of it gets its own stub from the feed.
    const fedDirect = !gens.length && step === 0 && !!feedNet;
    const feeds = (pos: Vec3) => [0, 2].some((y) => {
      const m = unitAt.get(posKey([pos[0], y, pos[2]]));
      return !!m && consumers.includes(m);
    });
    for (let x = 0; x < C; x++) {
      for (const side of [-1, 1]) {
        const pos: Vec3 = [x, 1, tidyZ(side, 1)];
        if (fedDirect && !feeds(pos)) continue;
        const input = transformers.get(posKey(pos));
        if (input !== undefined) {
          const key = transformerKey(supply);
          const t: Placed = { role: `xf:${supply}-${layerTier}`, key, name: CATALOG.get(key)!.name, transformer: { from: supply, to: layerTier }, tier: layerTier, pos, facing: input };
          units.push(t);
          unitAt.set(posKey(pos), t);
          if (!gens.length) feedStubs.push([x, 1, tidyZ(side, 2)]);
          continue;
        }
        if (!put(pos, layerNet.id)) return fail('no room for the power layer');
        for (const y of [0, 2]) {
          const m = unitAt.get(posKey([x, y, pos[2]]));
          if (m && consumers.includes(m)) serve(pos, m);
        }
        const g = genAt.get(posKey(pos));
        if (g) serve(pos, g); // a generator at the layer's voltage pushes straight into it
      }
      const [a, b]: Vec3[] = [[x, 1, 0], [x, 1, 1]];
      if (cellNet.get(posKey(a)) === layerNet.id && cellNet.get(posKey(b)) === layerNet.id) link(a, b);
    }
    // Machines at the supply voltage fed from the core: a feed stub, on its own side, joins each piece of the layer.
    if (fedDirect) {
      const seen = new Set<string>();
      for (let x = 0; x < C; x++) {
        for (const side of [-1, 1]) {
          const start = posKey([x, 1, tidyZ(side, 1)]);
          if (seen.has(start) || cellNet.get(start) !== layerNet.id) continue;
          feedStubs.push([x, 1, tidyZ(side, 2)]);
          const stack = [start];
          while (stack.length) {
            const k = stack.pop()!;
            if (seen.has(k) || cellNet.get(k) !== layerNet.id) continue;
            seen.add(k);
            const p = cellPos.get(k)!;
            for (const nk of [[p[0] - 1, 1, p[2]], [p[0] + 1, 1, p[2]], [p[0], 1, 1 - p[2]]] as Vec3[]) stack.push(posKey(nk));
          }
        }
      }
    }
  }
  /** Layer cells and same-voltage transformers beside `p` in the power layer (along x, and across the columns). */
  const layerNeighbours = (p: Vec3, id: string) => [4, 5, 2, 3].map((side) => posKey(addVec(p, DIRS[side]))).filter((nk) => {
    const n = cellPos.get(nk);
    return (cellNet.get(nk) === id && n![1] === 1 && n![0] < C) || unitAt.get(nk)?.transformer?.to === byIdTier(id);
  });
  const byIdTier = (id: string) => localPower.get(id)?.tier ?? (feedNet?.id === id ? feedNet.tier : undefined);

  // Blocks generators push straight into (a generator at the machines' voltage): power sources, like transformers.
  const genOutputs = new Set(gens.filter((g) => g.facing !== undefined).map((g) => posKey(addVec(g.pos, DIRS[g.facing!]))).filter((k) => localPower.has(cellNet.get(k) ?? '')));
  // Cut power cable that powers nothing: a layer block with no machine of its own and at most one neighbour in the
  // layer (a cable or a transformer of its voltage), over and over until none is left.
  for (let cut = true; cut; ) {
    cut = false;
    for (const [k, id] of [...cellNet]) {
      const p = cellPos.get(k)!;
      if (!localPower.has(id) || p[1] !== 1 || p[0] >= C) continue;
      const powers = [0, 2].some((y) => {
        const m = unitAt.get(posKey([p[0], y, p[2]]));
        return !!m && consumers.includes(m);
      });
      if (powers || layerNeighbours(p, id).length > 1 || genOutputs.has(k)) continue;
      cellNet.delete(k);
      cellPos.delete(k);
      for (const a of [...routed.attach]) if (a.startsWith(`${k}>`)) routed.attach.delete(a);
      routed.ends = routed.ends.filter((e) => posKey(e.cell) !== k);
      cut = true;
    }
  }

  // Cut spare power cable too: a layer block that powers no machine of its own and that every machine can do without
  // (it only closes a loop), one at a time while that holds.
  const layerCells = () => [...cellNet].filter(([k, id]) => localPower.has(id) && cellPos.get(k)![1] === 1 && cellPos.get(k)![0] < C).map(([k]) => k);
  const powered = (skip?: string): number => {
    const reached = new Set<string>();
    const seen = new Set<string>();
    const stack = [...units.filter((u) => u.transformer).map((u) => posKey(u.pos)), ...genOutputs];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k) || k === skip) continue;
      seen.add(k);
      const p = unitAt.get(k)?.pos ?? cellPos.get(k)!;
      for (const d of DIRS) {
        const nk = posKey(addVec(p, d));
        const m = unitAt.get(nk);
        if (m && consumers.includes(m)) reached.add(nk);
        if (d[1] === 0 && (localPower.has(cellNet.get(nk) ?? '') || m?.transformer)) stack.push(nk);
      }
    }
    return reached.size;
  };
  for (let cut = true; cut; ) {
    cut = false;
    const all = powered();
    for (const k of layerCells()) {
      const p = cellPos.get(k)!;
      const own = [0, 2].some((y) => {
        const m = unitAt.get(posKey([p[0], y, p[2]]));
        return !!m && consumers.includes(m);
      });
      if (own || genOutputs.has(k) || powered(k) < all) continue;
      cellNet.delete(k);
      cellPos.delete(k);
      for (const at of [...routed.attach]) if (at.startsWith(`${k}>`)) routed.attach.delete(at);
      routed.ends = routed.ends.filter((e) => posKey(e.cell) !== k);
      cut = true;
      break;
    }
  }

  // The feed from the core (slices without generators): along the outside, a stub to each transformer or the layer.
  if (feedNet) {
    for (const side of new Set(feedStubs.map((c) => sideOf(c[2])))) {
      for (let x = 0; x < L; x++) if (!put([x, 1, tidyZ(side, 3)], feedNet.id)) return fail('no room for the power feed');
    }
    for (const stub of feedStubs) {
      const side = sideOf(stub[2]);
      if (!put(stub, feedNet.id)) return fail('no room for a feed stub');
      const inner: Vec3 = [stub[0], 1, tidyZ(side, 1)];
      const t = unitAt.get(posKey(inner));
      if (t?.transformer) serve(stub, t);
      else link(stub, inner);
      link(stub, [stub[0], 1, tidyZ(side, 3)]);
    }
  }

  // Second inputs and outputs: a free face beside the machine (a gap column), placed before the through-runs so they are
  // carried on and joined like any other run.
  for (const { u, net, out } of extras) {
    const faces = [-1, 1]
      .map((dx): Vec3 => [u.pos[0] + dx, u.pos[1], u.pos[2]])
      .filter((c) => c[0] >= 0 && c[0] < L && !unitAt.has(posKey(c)) && (!cellNet.has(posKey(c)) || cellNet.get(posKey(c)) === net.id));
    // Prefer a face already carrying this network (a gap shared with a neighbour doing the same), then an empty one.
    const cell = faces.find((c) => cellNet.get(posKey(c)) === net.id) ?? faces.find((c) => !cellNet.has(posKey(c)));
    if (!cell) return fail(`no free face on the ${u.name} for ${net.name}`);
    put(cell, net.id);
    serve(cell, u);
    if (out) {
      const side = sideTo(u.pos, cell);
      const kind = net.kind === 'fluidPipe' ? 'pump' : 'conveyor';
      routed.covers.push({ pos: u.pos, side, kind });
      routed.notes.push(`Put a ${kind} cover on the ${SIDE_NAME[side]} of the ${u.name} at (${u.pos.join(', ')}), set to export, so ${net.name} goes into its own pipe.`);
    }
  }

  // Through-runs: every run of a network the core or other slices need carries on straight across the whole slice
  // (into the next slice and the core, which joins them), so slices only join their own local runs.
  const allNets = [...goods, ...(feedNet ? [feedNet] : []), ...localPower.values()];
  const byId = new Map(allNets.map((n) => [n.id, n]));
  const throughRuns = new Map<string, Vec3[][]>();
  const slotFree = (y: number, z: number, net: string) =>
    Array.from({ length: L }, (_, x) => posKey([x, y, z])).every((k) => !unitAt.has(k) && (!cellNet.has(k) || cellNet.get(k) === net));
  const spare: [number, number][] = [
    ...[-1, 3].flatMap((y) => [-1, 1].map((side): [number, number] => [y, tidyZ(side, 2)])),
    ...[-1, 0, 1, 2, 3].flatMap((y) => [-1, 1].map((side): [number, number] => [y, tidyZ(side, 3)])),
    // With machines one high, the upper level over the power layer is free for runs too.
    ...[2, 3].flatMap((y) => [-1, 1].map((side): [number, number] => [y, tidyZ(side, 1)])),
    // Relaxed lines may grow a block outward in every direction.
    ...(relaxed ? [
      ...[-2, -1, 0, 1, 2, 3, 4].flatMap((y) => [-1, 1].map((side): [number, number] => [y, tidyZ(side, 4)])),
      ...[-2, 4].flatMap((y) => [1, 2, 3].flatMap((d) => [-1, 1].map((side): [number, number] => [y, tidyZ(side, d)]))),
    ] : []),
  ];
  const used = (id: string) => [...cellNet.values()].includes(id);
  const spans = (n: Net) => n.kind === 'cable' ? n.id === feedNet?.id : [...n.producers, ...n.consumers].some((r) => !sliceRoles.has(r));
  // A straight line has one slice with the core at x < 0: any run that can carry on straight to x = 0 is joined by
  // the core, even one only this slice uses (a run stuck behind other machines in its row can't reach the service column).
  if (straight) {
    for (const n of allNets) {
      if (!used(n.id) || (n.kind === 'cable' && n.id !== feedNet?.id)) continue;
      const slots = new Map<string, { y: number; z: number; xs: number[] }>();
      for (const [k, id] of cellNet) {
        if (id !== n.id) continue;
        const [x, y, z] = cellPos.get(k)!;
        if (n.kind === 'cable' && Math.abs(z - 0.5) < 2) continue; // the feed itself, not its stubs or the layer
        const slot = slots.get(`${y},${z}`) ?? { y, z, xs: [] };
        slot.xs.push(x);
        slots.set(`${y},${z}`, slot);
      }
      const runs: Vec3[][] = [];
      for (const { y, z, xs } of slots.values()) {
        // The whole run from x = 0 to its far end, gaps between machines included, if those blocks are free.
        const run = Array.from({ length: Math.max(...xs) + 1 }, (_, x): Vec3 => [x, y, z]);
        if (!run.every((c) => !unitAt.has(posKey(c)) && (!cellNet.has(posKey(c)) || cellNet.get(posKey(c)) === n.id))) continue;
        for (const c of run) put(c, n.id);
        runs.push(run);
      }
      if (runs.length) throughRuns.set(n.id, runs);
    }
  }
  for (const n of allNets) {
    if (!used(n.id) || !spans(n) || throughRuns.has(n.id)) continue;
    const own = new Map<string, { slot: [number, number]; cells: number }>();
    for (const [k, id] of cellNet) {
      if (id !== n.id) continue;
      const [, y, z] = cellPos.get(k)!;
      const o = own.get(`${y},${z}`) ?? { slot: [y, z] as [number, number], cells: 0 };
      o.cells++;
      own.set(`${y},${z}`, o);
    }
    // Power carries on only along the feed itself (not its stubs).
    const fits = [...own.values()].sort((a, b) => b.cells - a.cells).map((o) => o.slot)
      .filter(([y, z]) => (n.kind !== 'cable' || Math.abs(z - 0.5) >= 2) && slotFree(y, z, n.id));
    const slots = fits;
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
  const canStep = (a: Vec3, b: Vec3) => relaxed || a[0] !== b[0] || svc(a[0]);
  // A cable may not run beside a cable of another voltage, nor beside a power output of a higher one (burn risk when
  // built by hand: GT cables join whatever they're placed against).
  const keepApart = (id: string): Set<string> => {
    const out = new Set<string>();
    const t = byId.get(id)?.tier;
    if (!t || byId.get(id)?.kind !== 'cable') return out;
    const around = (c: Vec3) => DIRS.forEach((d) => out.add(posKey(addVec(c, d))));
    for (const [k, n] of cellNet) {
      const other = byId.get(n);
      if (other?.kind === 'cable' && other.tier !== t) around(cellPos.get(k)!);
    }
    for (const u of unitAt.values()) {
      if (u.transformer && TIERS.indexOf(u.transformer.to) > TIERS.indexOf(t)) around(u.pos);
      if (u.pm?.generator && u.facing !== undefined && TIERS.indexOf(supply) > TIERS.indexOf(t)) out.add(posKey(addVec(u.pos, DIRS[u.facing])));
    }
    return out;
  };
  const grow = relaxed ? 1 : 0;
  const bounds = { min: [0, TIDY_BOUNDS.yMin - grow, TIDY_BOUNDS.zMin - grow] as Vec3, max: [L - 1, TIDY_BOUNDS.yMax + grow, TIDY_BOUNDS.zMax + grow] as Vec3 };
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
        const next: string[] = [];
        DIRS.forEach((d, side) => {
          const nk = posKey(addVec(p, d));
          // A transformer in the power layer gives its voltage on every side but its input, joining the cells around it.
          const t = unitAt.get(nk);
          if (t?.transformer && t.transformer.to === byId.get(id)?.tier) {
            DIRS.forEach((d2, s2) => {
              if (s2 !== t.facing) next.push(posKey(addVec(t.pos, d2)));
            });
            return;
          }
          if (cellNet.get(nk) !== id) return;
          if (side < 4 && !svc(p[0]) && !links.has(`${k}|${nk}`)) return;
          next.push(nk);
        });
        for (const nk of next) {
          if (seen.has(nk) || cellNet.get(nk) !== id) continue;
          seen.add(nk);
          stack.push(nk);
        }
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
  const powerOrder = feedNet && used(feedNet.id) ? [feedNet] : [];
  for (const n of powerFirst ? [...powerOrder, ...goodsOrder] : [...goodsOrder, ...powerOrder]) {
    const r = join(n.id);
    if ('fail' in r) return r;
  }

  itemFilters(routed, allNets);

  const sliceAmps = consumers.reduce((s, u) => s + Math.max(1, Math.ceil((u.pm?.eut ?? 0) / VOLTAGE[u.tier as PowerTier] - 1e-9)), 0);
  const layerCable = feedNet ? cableFor(feedNet.tier!, Math.max(1, sliceAmps)).key : '';
  // Conduits connect along their run, to the blocks they serve, across the power layer, and freely in the service column.
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
    // Fed from the core, the layer and its stubs carry only this slice's machines; the feed run carries the line.
    const key = feedNet && net === feedNet.id && Math.abs(pos[2] - 0.5) < 2 ? layerCable : byId.get(net)!.conduit;
    return { pos, key, net, manualMask: { forcedOn: on, forcedOff: 63 & ~on } };
  });

  return { length: L, serviceFrom: C, blocks: [...units.map(unitBlock), ...conduits], routed, throughRuns, nets: allNets, ...(gapCols.size ? { gaps: [...gapCols] } : {}) };
}
