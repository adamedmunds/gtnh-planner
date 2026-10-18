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
  /** Machines only. */
  facing?: Facing;
  /** Cables/pipes only. */
  manualMask?: ManualMask;
}

export interface Build {
  version: 1;
  name: string;
  blocks: PlacedBlock[];
}
