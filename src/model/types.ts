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

/** What a multiblock hatch or bus does for the structure. */
export type PortKind = 'in' | 'out' | 'energy' | 'maintenance';

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
  /** Generated pipes/cables: the network (`Build.networks` id) it belongs to. */
  net?: string;
  /** Transformers set to step up (soft mallet): the lower voltage in on five faces, the higher out of `facing`. */
  stepUp?: boolean;
  /**
   * Multiblock hatches and buses: what the port does, and which resources it handles (empty: it has nothing to move).
   * `locked`: an output hatch the schematic pastes locked to its one fluid.
   */
  port?: { kind: PortKind; keys: string[]; locked?: boolean };
}

/** What one generated pipe or cable network carries, for labels, highlight and the legend. */
export interface LineNetwork {
  id: string;
  name: string;
  kind: 'fluid' | 'item' | 'power';
  /** Resource key whose icon stands for it (items/fluids). */
  icon?: string;
  /** Power: the voltage. */
  tier?: string;
  /** Per second (L or items), or EU/t for power. */
  flow?: number;
  /** Catalog key of the pipe/cable used. */
  conduit: string;
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
  /** Generated lines: what each pipe/cable network carries. */
  networks?: LineNetwork[];
  /** Present while the build is an untouched generated line (enables "+ slice" and "Export one slice"). */
  generated?: GeneratedLine;
}
