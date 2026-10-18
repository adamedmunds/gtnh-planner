import { CATALOG, type Catalog, type CatalogEntry } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from './directions';
import type { PlacedBlock } from './types';

interface Cell {
  block: PlacedBlock;
  entry: CatalogEntry;
}

const bit = (side: number) => 1 << side;

/**
 * Connection mask for every cable/pipe in the build.
 * Auto rule: connect to any machine, or to a conduit of the same kind (any material).
 * Overrides: either piece's forcedOn turns a shared side on; either piece's forcedOff turns it off (off wins).
 */
export function computeConnections(
  blocks: readonly PlacedBlock[],
  catalog: Catalog = CATALOG,
): Map<string, number> {
  const cells = new Map<string, Cell>();
  for (const block of blocks) {
    const entry = catalog.get(block.key);
    if (entry) cells.set(posKey(block.pos), { block, entry });
  }

  const result = new Map<string, number>();
  for (const [key, { block, entry }] of cells) {
    if (entry.kind === 'machine' || entry.kind === 'marker') continue;
    const own = block.manualMask ?? { forcedOn: 0, forcedOff: 0 };
    let mask = 0;
    for (let side = 0; side < 6; side++) {
      const nb = cells.get(posKey(addVec(block.pos, DIRS[side])));
      const sameKindConduit = nb !== undefined && nb.entry.kind === entry.kind;
      const nbMask = sameKindConduit ? (nb.block.manualMask ?? { forcedOn: 0, forcedOff: 0 }) : undefined;
      const back = bit(OPPOSITE[side]);

      let on = nb !== undefined && (nb.entry.kind === 'machine' || nb.entry.kind === 'marker' || sameKindConduit);
      if (own.forcedOn & bit(side) || (nbMask && nbMask.forcedOn & back)) on = true;
      if (own.forcedOff & bit(side) || (nbMask && nbMask.forcedOff & back)) on = false;
      if (on) mask |= bit(side);
    }
    result.set(key, mask);
  }
  return result;
}
