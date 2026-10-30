import { CATALOG, isConduit, type Catalog } from '../catalog';
import { computeConnections } from './connections';
import { DIRS, OPPOSITE, addVec, posKey } from './directions';
import type { Facing, ManualMask, PlacedBlock, Vec3 } from './types';

export type BlockMap = ReadonlyMap<string, PlacedBlock>;

export const toBlockMap = (blocks: readonly PlacedBlock[]): BlockMap => new Map(blocks.map((b) => [posKey(b.pos), b]));

export function placeBlock(m: BlockMap, block: PlacedBlock): BlockMap {
  const k = posKey(block.pos);
  if (m.has(k)) return m;
  const next = new Map(m);
  next.set(k, block);
  return next;
}

export function removeBlock(m: BlockMap, pos: Vec3): BlockMap {
  const k = posKey(pos);
  if (!m.has(k)) return m;
  const next = new Map(m);
  next.delete(k);
  return next;
}

const HORIZONTAL: readonly Facing[] = [2, 5, 3, 4]; // N → E → S → W
const WITH_VERTICAL: readonly Facing[] = [2, 5, 3, 4, 1, 0];

export function nextFacing(f: Facing | undefined, includeVertical: boolean): Facing {
  const cycle = includeVertical ? WITH_VERTICAL : HORIZONTAL;
  const i = cycle.indexOf(f ?? 3);
  return cycle[(i + 1) % cycle.length];
}

function replace(m: BlockMap, block: PlacedBlock): BlockMap {
  const next = new Map(m);
  next.set(posKey(block.pos), block);
  return next;
}

export function rotateBlock(m: BlockMap, pos: Vec3, includeVertical: boolean, catalog: Catalog = CATALOG): BlockMap {
  const block = m.get(posKey(pos));
  if (!block || catalog.get(block.key)?.kind !== 'machine') return m;
  return replace(m, { ...block, facing: nextFacing(block.facing, includeVertical) });
}

function withMask(block: PlacedBlock, mask: ManualMask | undefined): PlacedBlock {
  const { manualMask: _old, ...rest } = block;
  void _old;
  return mask && (mask.forcedOn || mask.forcedOff) ? { ...rest, manualMask: mask } : rest;
}

/**
 * Flips one side of a cable/pipe: a connected side is forced off, an unconnected side forced on. An override
 * is only kept where it differs from what auto-connection would do, so toggling twice removes it again.
 */
export function toggleSide(m: BlockMap, pos: Vec3, side: number, catalog: Catalog = CATALOG): BlockMap {
  const k = posKey(pos);
  const block = m.get(k);
  const kind = block && catalog.get(block.key)?.kind;
  if (!block || !kind || !isConduit(kind) || side < 0 || side > 5) return m;
  const bit = 1 << side;
  const sideOn = (blocks: BlockMap) => ((computeConnections([...blocks.values()], catalog).get(k) ?? 0) & bit) !== 0;

  const connected = sideOn(m);
  const wantOn = !connected;

  // A neighbour's forced-off wins over our forced-on, so turning a side on also clears the neighbour's
  // opposing override; otherwise the toggle would appear to do nothing.
  let base = m;
  const nb = m.get(posKey(addVec(pos, DIRS[side])));
  const back = 1 << OPPOSITE[side];
  if (wantOn && nb?.manualMask && nb.manualMask.forcedOff & back && catalog.get(nb.key)?.kind === kind) {
    base = replace(base, withMask(nb, { forcedOn: nb.manualMask.forcedOn, forcedOff: nb.manualMask.forcedOff & ~back }));
  }

  const auto = sideOn(replace(base, withMask(block, undefined)));
  const mask = block.manualMask ?? { forcedOn: 0, forcedOff: 0 };
  const forcedOn = mask.forcedOn & ~bit;
  const forcedOff = mask.forcedOff & ~bit;
  const next: ManualMask = {
    forcedOn: wantOn && !auto ? forcedOn | bit : forcedOn,
    forcedOff: !wantOn && auto ? forcedOff | bit : forcedOff,
  };
  return replace(base, withMask(block, next));
}

export function placementFacing(normalSide: number, cameraForward: Vec3): Facing {
  if (normalSide >= 2 && normalSide <= 5) return normalSide as Facing;
  const [fx, , fz] = cameraForward;
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 4 : 5;
  return fz > 0 ? 2 : 3;
}

export interface BomLine { key: string; name: string; group: string; count: number }

const GROUP_ORDER = ['Machines', 'Power', 'Cables', 'Fluid pipes', 'Item pipes'];

export function billOfMaterials(blocks: Iterable<PlacedBlock>, catalog: Catalog = CATALOG): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const b of blocks) {
    const e = catalog.get(b.key);
    if (!e) continue;
    const line = lines.get(e.key) ?? { key: e.key, name: e.name, group: e.group, count: 0 };
    line.count++;
    lines.set(e.key, line);
  }
  const rank = (g: string) => GROUP_ORDER.indexOf(g) + 1 || GROUP_ORDER.length + 1;
  return [...lines.values()].sort((a, b) => rank(a.group) - rank(b.group) || a.name.localeCompare(b.name));
}
