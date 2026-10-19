/** `marker`: a stand-in for where something comes in or goes out; exported as a plain vanilla block. */
export type Kind = 'machine' | 'cable' | 'fluidPipe' | 'itemPipe' | 'marker';
export type Tier = 'LV' | 'MV' | 'HV';

export interface CatalogEntry {
  key: string;
  name: string;
  kind: Kind;
  /** GregTech MetaTileEntity ID written to the tile entity's `mID`. */
  mID: number;
  /** Block metadata for gregtech:gt.blockmachines (GT harvest-tool base type). */
  meta: number;
  tier?: Tier;
  group: string;
  /** Cables/pipes only: cross-section size as a fraction of a block. */
  thickness?: number;
  /** Material/placeholder colour, CSS hex. */
  color: string;
  /**
   * Paths relative to public/textures/. Machines: top/side/bottom + front overlay. Cables/pipes: `side` along
   * the length, `end` on the open end, `core` (cables) the wire under the insulation; tinted by `color`.
   */
  textures: { top?: string; side?: string; bottom?: string; front?: string; end?: string; core?: string };
  /** Cables: voltage tier and amps per 1x of thickness; `size` is the 1x/4x multiplier. */
  cable?: { tier: Tier; ampsPerSize: number; size: number; lossPerBlock: number };
  /** Fluid pipes: litres per second one pipe carries. */
  pipeCapacity?: number;
  /** Item pipes: items per second one pipe carries. */
  itemCapacity?: number;
  /** Markers: the vanilla block written to the schematic instead of a GregTech block. */
  vanilla?: string;
}

/** A machine from the recipe data that isn't in the hand-made catalog; saved with the build that uses it. */
export interface GeneratedMachine {
  key: string;
  name: string;
  mID: number;
  /** GT tier name, e.g. "HV" (may be above HV; textures use the HV casing then). */
  tier?: string;
}

export type Catalog = ReadonlyMap<string, CatalogEntry>;

export const GT_BLOCK_NAME = 'gregtech:gt.blockmachines';
