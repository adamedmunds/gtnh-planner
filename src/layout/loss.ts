import { CATALOG, type CatalogEntry } from '../catalog';
import { computeConnections } from '../model/connections';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import type { Build, Vec3 } from '../model/types';
import { VOLTAGE } from './power';
import type { LinePlan, PlanMachine, PowerTier } from './types';

const TIER_ORDER: readonly PowerTier[] = ['LV', 'MV', 'HV'];

interface Cell { pos: Vec3; entry: CatalogEntry; facing?: number; role?: string; stepUp?: boolean }

/**
 * EU/t lost in cables: every machine draws EU/t ÷ voltage amps on average over its shortest cable run from a power source
 * (generator face, transformer low side, power marker), losing the cable's loss per block for each amp and block; a
 * transformer draws what the machines it feeds use, ÷ its higher voltage, over the run to its input face.
 */
export function cableLoss(build: Build, plan: LinePlan): { total: number; perMachine: Map<string, number> } {
  const cells = new Map<string, Cell>();
  for (const b of build.blocks) {
    const entry = CATALOG.get(b.key);
    if (entry) cells.set(posKey(b.pos), { pos: b.pos, entry, facing: b.facing, role: b.role, stepUp: b.stepUp });
  }
  const masks = computeConnections(build.blocks);
  const byNode = new Map<string, PlanMachine>([...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])].map((m) => [m.nodeId, m]));
  const isCable = (c?: Cell) => c?.entry.kind === 'cable';
  const connected = (c: Cell, side: number) => ((masks.get(posKey(c.pos)) ?? 0) & (1 << side)) !== 0;

  // Cable cells next to a power source, on a face that gives power (and which source it is).
  const sources: { cable: string; source: string }[] = [];
  for (const c of cells.values()) {
    const gen = byNode.get(c.role ?? '')?.generator;
    const transformer = c.entry.key.startsWith('transformer_');
    const marker = c.entry.key === 'marker_power_in';
    if (!gen && !transformer && !marker) continue;
    DIRS.forEach((d, side) => {
      const gives = gen || c.stepUp ? side === c.facing : transformer ? side !== c.facing : true;
      const n = cells.get(posKey(addVec(c.pos, d)));
      if (gives && n && isCable(n) && connected(n, OPPOSITE[side])) sources.push({ cable: posKey(n.pos), source: posKey(c.pos) });
    });
  }

  // Blocks from the nearest source, through connected cables.
  const dist = new Map<string, number>(sources.map((s) => [s.cable, 1]));
  const origin = new Map<string, string>(sources.map((s) => [s.cable, s.source]));
  const queue = sources.map((s) => s.cable);
  while (queue.length) {
    const k = queue.shift()!;
    const c = cells.get(k)!;
    DIRS.forEach((d, side) => {
      if (!connected(c, side)) return;
      const n = cells.get(posKey(addVec(c.pos, d)));
      if (!n || !isCable(n) || dist.has(posKey(n.pos))) return;
      dist.set(posKey(n.pos), dist.get(k)! + 1);
      origin.set(posKey(n.pos), origin.get(k)!);
      queue.push(posKey(n.pos));
    });
  }

  /** The nearest cable feeding `c` (machines: any face but their front/output; transformers: their input face). */
  const nearest = (c: Cell, transformerHigh: boolean) => {
    let best: { d: number; loss: number; from: string } | undefined;
    DIRS.forEach((d, side) => {
      // A transformer takes power in on its facing (step-down) or on its other faces (step-up).
      if (transformerHigh ? (c.stepUp ? side === c.facing : side !== c.facing) : side === c.facing) return;
      const n = cells.get(posKey(addVec(c.pos, d)));
      const nd = n && dist.get(posKey(n.pos));
      if (!n || !isCable(n) || nd === undefined || !connected(n, OPPOSITE[side])) return;
      if (!best || nd < best.d) best = { d: nd, loss: n.entry.cable!.lossPerBlock, from: origin.get(posKey(n.pos))! };
    });
    return best;
  };
  const isTransformer = (c?: Cell) => !!c && c.entry.key.startsWith('transformer_');
  const tierOfVoltage = (t?: string) => (t === 'ULV' ? 'LV' : t ?? 'LV') as PowerTier;

  // Machines draw EU/t ÷ their voltage amps on average; a transformer draws what the machines it feeds use, in
  // packets of its higher voltage (lower-voltage transformers first, so a chain of steps adds up).
  const fedEu = new Map<string, number>(); // transformer posKey -> EU/t it passes on
  const perMachine = new Map<string, number>();
  let total = 0;
  for (const c of cells.values()) {
    const pm = byNode.get(c.role ?? '');
    if (!pm || pm.generator || !pm.eut || isTransformer(c)) continue;
    const best = nearest(c, false);
    if (best) {
      const lost = best.d * best.loss * (pm.eut / (VOLTAGE[tierOfVoltage(pm.tier)] ?? VOLTAGE.LV));
      perMachine.set(posKey(c.pos), lost);
      total += lost;
    }
    // Who supplies it: the source of its nearest cable, else a transformer it touches directly.
    const direct = DIRS.map((d) => cells.get(posKey(addVec(c.pos, d)))).find((n) => isTransformer(n) && n!.facing !== undefined);
    const from = best?.from ?? (direct ? posKey(direct.pos) : undefined);
    if (from && isTransformer(cells.get(from))) fedEu.set(from, (fedEu.get(from) ?? 0) + pm.eut);
  }
  const steps = [...cells.values()].filter(isTransformer).sort((a, b) => TIER_ORDER.indexOf(tierOfVoltage(a.entry.tier)) - TIER_ORDER.indexOf(tierOfVoltage(b.entry.tier)));
  for (const t of steps) {
    const eu = fedEu.get(posKey(t.pos)) ?? 0;
    const best = nearest(t, true);
    if (!best || !eu) continue;
    const high = TIER_ORDER[TIER_ORDER.indexOf(tierOfVoltage(t.entry.tier)) + 1] ?? 'MV';
    // It draws in packets of the voltage it takes in: the higher for a step-down, the lower for a step-up.
    const lost = best.d * best.loss * (eu / VOLTAGE[t.stepUp ? tierOfVoltage(t.entry.tier) : high]);
    perMachine.set(posKey(t.pos), lost);
    total += lost;
    if (isTransformer(cells.get(best.from))) fedEu.set(best.from, (fedEu.get(best.from) ?? 0) + eu);
  }
  return { total, perMachine };
}
