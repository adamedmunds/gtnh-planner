import { CATALOG, type CatalogEntry } from '../catalog';
import { computeConnections } from '../model/connections';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import type { Build, PlacedBlock, Vec3 } from '../model/types';
import type { LinePlan, PlanMachine } from './types';

interface Cell { block: PlacedBlock; entry: CatalogEntry }

const TIERS = ['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV'];
const tierIdx = (t?: string) => (t ? TIERS.indexOf(t) : -1);
const where = (p: Vec3) => `(${p.join(', ')})`;
const isConduit = (e: CatalogEntry) => e.kind === 'cable' || e.kind === 'fluidPipe' || e.kind === 'itemPipe';
const isTransformer = (e: CatalogEntry) => e.key.startsWith('transformer_');

/**
 * Proves a line is buildable as laid out: every machine gets each input and can push out each output on the face
 * GregTech uses (or a recorded cover/setting), fluids never mix, every machine gets power at a voltage it survives,
 * and — for generated lines — the walkway is clear and every slice is identical. Returns plain problems, [] if none.
 */
export function checkLine(build: Build, plan: LinePlan): string[] {
  const problems: string[] = [];
  const cells = new Map<string, Cell>();
  for (const block of build.blocks) {
    const entry = CATALOG.get(block.key);
    if (entry) cells.set(posKey(block.pos), { block, entry });
    else problems.push(`Unknown block "${block.key}" at ${where(block.pos)}`);
  }
  const masks = computeConnections(build.blocks);
  const neighbour = (c: Cell, side: number) => cells.get(posKey(addVec(c.block.pos, DIRS[side])));

  // Conduit components: same-kind pieces joined by connected sides.
  const compOf = new Map<string, number>();
  const comps: { kind: CatalogEntry['kind']; cells: Cell[] }[] = [];
  for (const [k, c] of cells) {
    if (!isConduit(c.entry) || compOf.has(k)) continue;
    const id = comps.length;
    comps.push({ kind: c.entry.kind, cells: [] });
    const stack = [c];
    compOf.set(k, id);
    while (stack.length) {
      const cur = stack.pop()!;
      comps[id].cells.push(cur);
      const mask = masks.get(posKey(cur.block.pos)) ?? 0;
      for (let side = 0; side < 6; side++) {
        if (!(mask & (1 << side))) continue;
        const n = neighbour(cur, side);
        if (!n || n.entry.kind !== cur.entry.kind) continue;
        const nk = posKey(n.block.pos);
        if (!compOf.has(nk)) {
          compOf.set(nk, id);
          stack.push(n);
        }
      }
    }
  }
  /** Conduit components touching a block, with the block's side they touch. */
  const attachments = (c: Cell) => {
    const out: { side: number; comp: number }[] = [];
    for (let side = 0; side < 6; side++) {
      const n = neighbour(c, side);
      if (!n || !isConduit(n.entry)) continue;
      if ((masks.get(posKey(n.block.pos)) ?? 0) & (1 << OPPOSITE[side])) out.push({ side, comp: compOf.get(posKey(n.block.pos))! });
    }
    return out;
  };

  // Which plan machine (or marker) each block is: its role, else the only plan machine with that key.
  const planMachines = [...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])];
  const byNode = new Map(planMachines.map((m) => [m.nodeId, m]));
  const roleOf = (c: Cell): string | undefined => {
    if (c.block.role) return c.block.role;
    const same = planMachines.filter((m) => m.key === c.block.key);
    return same.length === 1 ? same[0].nodeId : undefined;
  };
  const blocksOf = new Map<string, Cell[]>();
  for (const c of cells.values()) {
    const r = roleOf(c);
    if (r) blocksOf.set(r, [...(blocksOf.get(r) ?? []), c]);
  }
  const setting = (c: Cell, side: number, kind: string) =>
    (build.covers ?? []).some((s) => posKey(s.pos) === posKey(c.block.pos) && s.side === side && s.kind === kind);
  const label = (c: Cell) => `${c.entry.name} at ${where(c.block.pos)}`;
  /** The face that takes nothing in: a basic machine's front, else (old-style blocks) the output side. */
  const frontOf = (c: Cell) => c.block.mainFacing ?? c.block.facing;
  const SIDE = ['bottom', 'top', 'north side', 'south side', 'west side', 'east side'];

  // Fronts: sideways, not the output side, and nothing attached.
  for (const c of cells.values()) {
    const front = c.block.mainFacing;
    if (front === undefined) continue;
    if (front < 2) problems.push(`The front of the ${label(c)} must face sideways, not up or down`);
    if (front === c.block.facing) problems.push(`The front of the ${label(c)} is also its output side, so nothing could come out`);
    if (attachments(c).some((a) => a.side === front)) problems.push(`Something is connected to the front of the ${label(c)} — fronts take nothing in`);
  }

  // Item and fluid networks.
  const compNets = new Map<number, Set<string>>();
  for (const net of plan.networks) {
    const kind = net.kind === 'fluid' ? 'fluidPipe' : 'itemPipe';
    const cover = net.kind === 'fluid' ? 'pump' : 'conveyor';
    const candidates: { producing: boolean; comps: Set<number> }[] = [];
    const endpoint = (id: string, producing: boolean) => {
      const blocks = blocksOf.get(id);
      if (!blocks?.length) {
        problems.push(`${byNode.get(id)?.machine.name ?? id} is missing (needed for ${net.name})`);
        return;
      }
      for (const c of blocks) {
        const marker = c.entry.kind === 'marker';
        const ok = attachments(c).filter(({ side, comp }) => {
          if (comps[comp].kind !== kind) return false;
          if (marker) return true;
          if (producing) return side === c.block.facing || setting(c, side, cover);
          return side !== c.block.facing || setting(c, side, 'inputFromOutput');
        });
        if (!ok.length) {
          const viaOutput = !producing && attachments(c).some(({ side, comp }) => comps[comp].kind === kind && side === c.block.facing);
          problems.push(
            producing
              ? `${net.name} can't get out of the ${label(c)}`
              : viaOutput
                ? `The ${label(c)} gets ${net.name} through its output face — make sure "input from output side" is on (screwdriver), or feed it from another side`
                : `The ${label(c)} gets no ${net.name}`,
          );
          continue;
        }
        candidates.push({ producing, comps: new Set(ok.map((o) => o.comp)) });
      }
    };
    for (const p of net.producers) endpoint(p, true);
    for (const q of net.consumers) endpoint(q, false);
    if (!candidates.length) continue;
    // A network may be several pipes (e.g. one per slice), as long as every maker's and user's pipe joins both.
    const makers = new Set(candidates.filter((c) => c.producing).flatMap((c) => [...c.comps]));
    const users = new Set(candidates.filter((c) => !c.producing).flatMap((c) => [...c.comps]));
    const whole = (comp: number) => makers.has(comp) && users.has(comp);
    if (!candidates.every((c) => [...c.comps].some(whole))) problems.push(`${net.name} is split into pipes that don't join`);
    for (const comp of [...makers].filter(whole)) compNets.set(comp, new Set([...(compNets.get(comp) ?? []), net.name]));
  }
  for (const [comp, nets] of compNets) {
    if (comps[comp].kind === 'fluidPipe' && nets.size > 1) {
      problems.push(`A pipe at ${where(comps[comp].cells[0].block.pos)} joins ${[...nets].join(' and ')}, which would mix`);
    }
  }

  // A pipe carrying several kinds of item to several places: a place that should take one kind needs an Item Filter.
  for (const [comp, names] of compNets) {
    if (comps[comp].kind !== 'itemPipe' || names.size < 2) continue;
    const here = plan.networks.filter((n) => n.kind === 'item' && names.has(n.name));
    const takers = new Set(here.flatMap((n) => n.consumers));
    if (takers.size < 2) continue;
    for (const role of takers) {
      const wants = here.filter((n) => n.consumers.includes(role));
      if (wants.length !== 1) continue;
      for (const c of blocksOf.get(role) ?? []) {
        const faces = attachments(c).filter((a) => a.comp === comp);
        const filtered = faces.some(({ side }) => {
          const pipe = neighbour(c, side)!;
          return (build.covers ?? []).some((s) => s.kind === 'itemFilter' && s.item === wants[0].key &&
            ((posKey(s.pos) === posKey(c.block.pos) && s.side === side) || (posKey(s.pos) === posKey(pipe.block.pos) && s.side === OPPOSITE[side])));
        });
        if (faces.length && !filtered) {
          problems.push(`The pipe into the ${label(c)} also carries other items — put an Item Filter cover set to ${wants[0].name} on its ${SIDE[faces[0].side]}`);
        }
      }
    }
  }

  // Power: generators push out of their face; transformers take the higher voltage on their face and give the
  // lower one on every other side; a "power in" marker feeds everything around it.
  const fed = new Map<string, number>(); // block posKey or `c<comp>` -> tier index reaching it
  const machineTier = (c: Cell) => tierIdx(byNode.get(roleOf(c) ?? '')?.tier ?? c.entry.tier);
  const queue: { c: Cell; side: number; tier: number }[] = [];
  const emitAll = (c: Cell, tier: number, sides: number[]) => sides.forEach((side) => queue.push({ c, side, tier }));
  const allSides = [0, 1, 2, 3, 4, 5];
  for (const c of cells.values()) {
    const m = byNode.get(roleOf(c) ?? '');
    if (m?.generator && c.block.facing !== undefined) emitAll(c, machineTier(c), [c.block.facing]);
    if (c.entry.key === 'marker_power_in') emitAll(c, tierIdx(plan.power.source.tier), allSides);
  }
  const raise = (k: string, tier: number) => {
    if ((fed.get(k) ?? -1) >= tier) return false;
    fed.set(k, tier);
    return true;
  };
  const feedBlock = (n: Cell, fromSide: number, tier: number) => {
    // `fromSide` is the side of `n` the power arrives on.
    if (isTransformer(n.entry) && n.block.stepUp) {
      // Step-up: the lower voltage in on any face but its facing, the higher out of its facing.
      const low = tierIdx(n.entry.tier);
      if (fromSide === n.block.facing || tier !== low) return;
      if (raise(posKey(n.block.pos), tier)) emitAll(n, low + 1, [n.block.facing!]);
      return;
    }
    if (isTransformer(n.entry)) {
      if (fromSide !== n.block.facing) return;
      if (raise(posKey(n.block.pos), tier)) {
        const low = tierIdx(n.entry.tier);
        if (tier === low + 1) emitAll(n, low, allSides.filter((s) => s !== n.block.facing));
      }
      return;
    }
    // GT machines take power on every side but their front.
    if (n.entry.kind === 'machine' && !byNode.get(roleOf(n) ?? '')?.generator && fromSide !== frontOf(n)) raise(posKey(n.block.pos), tier);
  };
  while (queue.length) {
    const { c, side, tier } = queue.pop()!;
    const n = neighbour(c, side);
    if (!n) continue;
    if (n.entry.kind === 'cable') {
      if (!((masks.get(posKey(n.block.pos)) ?? 0) & (1 << OPPOSITE[side]))) continue;
      const comp = compOf.get(posKey(n.block.pos))!;
      if (!raise(`c${comp}`, tier)) continue;
      for (const cell of comps[comp].cells) {
        const mask = masks.get(posKey(cell.block.pos)) ?? 0;
        for (let s = 0; s < 6; s++) {
          if (!(mask & (1 << s))) continue;
          const target = neighbour(cell, s);
          if (target && !isConduit(target.entry)) feedBlock(target, OPPOSITE[s], tier);
        }
      }
    } else feedBlock(n, OPPOSITE[side], tier);
  }
  for (const [comp, { kind, cells: list }] of comps.entries()) {
    const tier = fed.get(`c${comp}`);
    if (kind !== 'cable' || tier === undefined) continue;
    const weakest = list.find((c) => tierIdx(c.entry.cable?.tier) < tier);
    if (weakest) problems.push(`The ${weakest.entry.name} at ${where(weakest.block.pos)} can't carry ${TIERS[tier]} power`);
  }
  // Burn risk: GT cables join any other cable, and a cable placed against something connects to it, so a cable must not
  // touch a live cable of a higher voltage or a power output of one — connected here or not.
  const rated = (c: Cell) => tierIdx(c.entry.cable?.tier);
  const warned = new Set<string>();
  const burn = (c: Cell, what: string, tier: number) => {
    const k = posKey(c.block.pos);
    if (warned.has(k)) return;
    warned.add(k);
    problems.push(`The ${label(c)} touches ${what} carrying ${TIERS[tier]} — if they connect when you build it, the ${c.entry.name} burns. Keep them apart`);
  };
  for (const c of cells.values()) {
    if (c.entry.kind !== 'cable') continue;
    for (let side = 0; side < 6; side++) {
      const n = neighbour(c, side);
      if (!n) continue;
      if (n.entry.kind === 'cable') {
        const live = fed.get(`c${compOf.get(posKey(n.block.pos))}`);
        if (live !== undefined && live > rated(c)) burn(c, `the ${label(n)}`, live);
        continue;
      }
      // Faces of `n` that push power out toward `c`.
      const toward = OPPOSITE[side];
      const m = byNode.get(roleOf(n) ?? '');
      let out: number | undefined;
      if (m?.generator && n.block.facing === toward) out = machineTier(n);
      else if (isTransformer(n.entry) && n.block.stepUp) out = n.block.facing === toward ? tierIdx(n.entry.tier) + 1 : undefined;
      else if (isTransformer(n.entry) && n.block.facing !== toward) out = tierIdx(n.entry.tier);
      else if (n.entry.key === 'marker_power_in') out = tierIdx(plan.power.source.tier);
      if (out !== undefined && out > rated(c)) burn(c, `the power output of the ${label(n)}`, out);
    }
  }

  for (const c of cells.values()) {
    if (c.entry.kind !== 'machine' || isTransformer(c.entry)) continue;
    const m = byNode.get(roleOf(c) ?? '');
    if (m?.generator || m?.multiblock) continue;
    const tier = fed.get(posKey(c.block.pos));
    if (tier === undefined) problems.push(`No power reaches the ${label(c)}`);
    else if (tier > machineTier(c)) problems.push(`The ${label(c)} gets ${TIERS[tier]} power — too much voltage for an ${TIERS[machineTier(c)]} machine`);
  }

  // Generated lines: a clear walkway, and every slice exactly like the first.
  const g = build.generated;
  if (g) {
    const xs = build.blocks.map((b) => b.pos[0]);
    if (g.walkway !== false) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        for (const y of [0, 1]) if (cells.has(posKey([x, y, 0]))) problems.push(`Something is in the walkway at ${where([x, y, 0])}`);
      }
    }
    if (g.style === 'modular') {
      const sig = (blocks: PlacedBlock[], x0: number) =>
        blocks.map((b) => `${b.pos[0] - x0},${b.pos[1]},${b.pos[2]}:${b.key}:${b.facing ?? ''}:${b.manualMask?.forcedOn ?? ''}/${b.manualMask?.forcedOff ?? ''}`).sort().join('|');
      const template = sig(g.template, 0);
      const starts = [
        ...Array.from({ length: g.left }, (_, k) => g.leftStart + k * g.sliceLength),
        ...Array.from({ length: g.right }, (_, k) => g.rightStart + k * g.sliceLength),
      ];
      starts.forEach((x0, i) => {
        const inside = build.blocks.filter((b) => b.pos[0] >= x0 && b.pos[0] < x0 + g.sliceLength);
        if (sig(inside, x0) !== template) problems.push(`Slice ${i + 1} differs from the others, so pasting slices wouldn't line up`);
      });
    }
  }
  return problems;
}

export type { PlanMachine };
