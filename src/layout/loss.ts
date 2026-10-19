import { CATALOG, type CatalogEntry } from '../catalog';
import { computeConnections } from '../model/connections';
import { DIRS, OPPOSITE, addVec, posKey } from '../model/directions';
import type { Build, Vec3 } from '../model/types';
import { VOLTAGE } from './power';
import type { LinePlan, PlanMachine, PowerTier } from './types';

interface Cell { pos: Vec3; entry: CatalogEntry; facing?: number; role?: string }

/**
 * EU/t lost in cables: every machine draws EU/t ÷ voltage amps on average over its shortest cable run from a power source
 * (generator face, transformer low side, power marker), losing the cable's loss per block for each amp and block.
 */
export function cableLoss(build: Build, plan: LinePlan): { total: number; perMachine: Map<string, number> } {
  const cells = new Map<string, Cell>();
  for (const b of build.blocks) {
    const entry = CATALOG.get(b.key);
    if (entry) cells.set(posKey(b.pos), { pos: b.pos, entry, facing: b.facing, role: b.role });
  }
  const masks = computeConnections(build.blocks);
  const byNode = new Map<string, PlanMachine>([...(plan.slice ?? []), ...plan.core, ...(plan.straight ?? [])].map((m) => [m.nodeId, m]));
  const isCable = (c?: Cell) => c?.entry.kind === 'cable';
  const connected = (c: Cell, side: number) => ((masks.get(posKey(c.pos)) ?? 0) & (1 << side)) !== 0;

  // Cable cells next to a power source, on a face that gives power.
  const sources: string[] = [];
  for (const c of cells.values()) {
    const gen = byNode.get(c.role ?? '')?.generator;
    const transformer = c.entry.key.startsWith('transformer_');
    const marker = c.entry.key === 'marker_power_in';
    if (!gen && !transformer && !marker) continue;
    DIRS.forEach((d, side) => {
      const gives = gen ? side === c.facing : transformer ? side !== c.facing : true;
      const n = cells.get(posKey(addVec(c.pos, d)));
      if (gives && n && isCable(n) && connected(n, OPPOSITE[side])) sources.push(posKey(n.pos));
    });
  }

  // Blocks from the nearest source, through connected cables.
  const dist = new Map<string, number>(sources.map((k) => [k, 1]));
  const queue = [...sources];
  while (queue.length) {
    const k = queue.shift()!;
    const c = cells.get(k)!;
    DIRS.forEach((d, side) => {
      if (!connected(c, side)) return;
      const n = cells.get(posKey(addVec(c.pos, d)));
      if (!n || !isCable(n) || dist.has(posKey(n.pos))) return;
      dist.set(posKey(n.pos), dist.get(k)! + 1);
      queue.push(posKey(n.pos));
    });
  }

  const perMachine = new Map<string, number>();
  let total = 0;
  for (const c of cells.values()) {
    const pm = byNode.get(c.role ?? '');
    const transformerHigh = c.entry.key.startsWith('transformer_');
    if ((!pm || pm.generator || !pm.eut) && !transformerHigh) continue;
    let best: { d: number; loss: number } | undefined;
    DIRS.forEach((d, side) => {
      if (transformerHigh ? side !== c.facing : side === c.facing) return;
      const n = cells.get(posKey(addVec(c.pos, d)));
      const nd = n && dist.get(posKey(n.pos));
      if (!n || !isCable(n) || nd === undefined || !connected(n, OPPOSITE[side])) return;
      if (!best || nd < best.d) best = { d: nd, loss: n.entry.cable!.lossPerBlock };
    });
    if (!best) continue;
    const { d, loss } = best;
    // A transformer draws about one amp of the higher voltage; a machine draws its EU/t in packets of its own voltage.
    const voltage = VOLTAGE[(pm?.tier === 'ULV' ? 'LV' : pm?.tier ?? 'LV') as PowerTier] ?? VOLTAGE.LV;
    // Packets are a full voltage each; on average a machine draws EU/t ÷ voltage of them per tick.
    const amps = transformerHigh ? 1 : pm!.eut / voltage;
    const lost = d * loss * amps;
    perMachine.set(posKey(c.pos), lost);
    total += lost;
  }
  return { total, perMachine };
}
