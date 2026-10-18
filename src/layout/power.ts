import { CATALOG_ENTRIES, type CatalogEntry } from '../catalog';
import { V } from '../calc/tiers';
import type { PowerTier } from './types';

const TIER_ORDER: readonly PowerTier[] = ['LV', 'MV', 'HV'];
export const VOLTAGE: Record<PowerTier, number> = { LV: V[1], MV: V[2], HV: V[3] };

const amps = (e: CatalogEntry) => e.cable!.ampsPerSize * e.cable!.size;

/**
 * The cable for a network at `tier` carrying `needed` amps: the lowest-tier cable rated for the voltage that
 * carries it (a higher-tier cable is fine at a lower voltage); otherwise the biggest one, with a warning.
 */
export function cableFor(tier: PowerTier, needed: number): { key: string; warning?: string } {
  const ok = CATALOG_ENTRIES.filter((e) => e.cable && TIER_ORDER.indexOf(e.cable.tier as PowerTier) >= TIER_ORDER.indexOf(tier))
    .sort((a, b) => TIER_ORDER.indexOf(a.cable!.tier as PowerTier) - TIER_ORDER.indexOf(b.cable!.tier as PowerTier) || amps(a) - amps(b));
  const fit = ok.find((e) => amps(e) >= needed - 1e-9);
  if (fit) return { key: fit.key };
  const biggest = [...ok].sort((a, b) => amps(b) - amps(a))[0];
  return { key: biggest.key, warning: `The ${tier} power line needs more than one ${biggest.name} carries (${Math.ceil(needed)} A) — run a second cable alongside it` };
}

/** The smallest pipe that carries `flow` per second (litres for fluids, items for items). */
export function pipeFor(kind: 'fluid' | 'item', flow: number): { key: string; warning?: string } {
  const pipes = CATALOG_ENTRIES.filter((e) => (kind === 'fluid' ? e.kind === 'fluidPipe' : e.kind === 'itemPipe'));
  const cap = (e: CatalogEntry) => (kind === 'fluid' ? e.pipeCapacity : e.itemCapacity) ?? 0;
  const sorted = [...pipes].sort((a, b) => cap(a) - cap(b) || a.thickness! - b.thickness!);
  const fit = sorted.find((e) => cap(e) >= flow - 1e-9);
  if (fit) return { key: fit.key };
  const biggest = sorted[sorted.length - 1];
  return { key: biggest.key, warning: `This line moves more than one ${biggest.name} carries — run a second pipe alongside it` };
}
