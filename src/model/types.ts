import type { GeneratedMachine } from '../catalog/types';
import type { GeneratedLine } from '../layout/types';

export type Vec3 = readonly [number, number, number];

/** GT/Forge side order: 0 down, 1 up, 2 north (-Z), 3 south (+Z), 4 west (-X), 5 east (+X). */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

/** Per-side user overrides for cable/pipe connections (bit n = side n). */
export interface ManualMask {
  forcedOn: number;
  forcedOff: number;
}

export interface PlacedBlock {
  pos: Vec3;
  key: string;
  /** Machines only: the output side (GT `mFacing`). */
  facing?: Facing;
  /**
   * GregTech basic machines only: the front (GT `mMainFacing`, horizontal), which shows the machine's picture and
   * takes nothing in. When absent the machine is drawn and exported the old way, front = output side.
   */
  mainFacing?: Facing;
  /** Cables/pipes only. */
  manualMask?: ManualMask;
  /** Generated lines: which recipe node or marker this block is. */
  role?: string;
}

/** Something to set on a machine face in game: a cover, or GregTech's "input from output side" screwdriver toggle. */
export interface FaceSetting {
  pos: Vec3;
  side: Facing;
  kind: 'pump' | 'conveyor' | 'inputFromOutput' | 'itemFilter';
  /** Item Filter covers: the one item let through. */
  item?: string;
}

export interface Build {
  version: 1;
  name: string;
  blocks: PlacedBlock[];
  /** Recipe machines the blocks use that aren't in the hand-made catalog. */
  machines?: GeneratedMachine[];
  /** Plain notes for building it (covers to add, what slices handle, warnings). */
  notes?: string[];
  /** Covers and face settings the layout relies on. */
  covers?: FaceSetting[];
  /** Present while the build is an untouched generated line (enables "+ slice" and "Export one slice"). */
  generated?: GeneratedLine;
}
