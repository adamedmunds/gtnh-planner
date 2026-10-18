export type Kind = 'machine' | 'cable' | 'fluidPipe' | 'itemPipe';
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
  /** Paths relative to public/textures/. */
  textures: { top?: string; side?: string; bottom?: string; front?: string };
}

export type Catalog = ReadonlyMap<string, CatalogEntry>;

export const GT_BLOCK_NAME = 'gregtech:gt.blockmachines';
