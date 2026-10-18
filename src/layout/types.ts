import type { GeneratedMachine } from '../catalog/types';
import type { Build, PlacedBlock } from '../model/types';
import type { ResourceKey } from '../recipes/types';

export type LayoutStyle = 'modular' | 'straight';
export type PowerTier = 'LV' | 'MV' | 'HV';

/** One kind of machine in the plan, with how many go in a slice, in the core, or in a straight line. */
export interface PlanMachine {
  nodeId: string;
  /** Catalog key: the hand-made entry for this machine if there is one, else `gt_<mID>` (or a multiblock marker). */
  key: string;
  machine: GeneratedMachine;
  tier?: string;
  count: number;
  /** EU/t one machine uses at full speed (generators: EU/t one makes). */
  eut: number;
  inputs: ResourceKey[];
  outputs: ResourceKey[];
  generator: boolean;
  multiblock: boolean;
}

/** Something that flows between machines or to/from a marker; producers/consumers are node ids or marker ids. */
export interface PlanNetwork {
  key: ResourceKey;
  name: string;
  kind: 'fluid' | 'item';
  /** Per second, whole build. */
  flow: number;
  producers: string[];
  consumers: string[];
}

export interface PlanMarker {
  id: string;
  key: ResourceKey;
  dir: 'in' | 'out';
  kind: 'item' | 'fluid' | 'power';
}

export interface PowerPlan {
  /** Voltage tiers the machines run at, lowest first. */
  tiers: PowerTier[];
  source: { kind: 'generators'; tier: PowerTier } | { kind: 'outside'; tier: PowerTier; eut: number };
  /** EU/t used by machines of each tier (whole build). */
  demand: Partial<Record<PowerTier, number>>;
  transformers: { from: PowerTier; to: PowerTier; count: number }[];
}

export interface LinePlan {
  style: LayoutStyle;
  slice?: PlanMachine[];
  sliceCount: number;
  core: PlanMachine[];
  /** How many slices one core can serve. */
  coreServes?: number;
  /** Input per slice, per second, for notes after growing ("handles 7 Oil Berry/s"). */
  inputsPerSlice?: { key: ResourceKey; amount: number };
  straight?: PlanMachine[];
  networks: PlanNetwork[];
  markers: PlanMarker[];
  power: PowerPlan;
  notes: string[];
  /** Why a modular request was laid out straight. */
  fallback?: string;
}

/** What a generated modular line remembers so it can grow by slices and export one slice. */
export interface GeneratedLine {
  style: LayoutStyle;
  sliceLength: number;
  sliceCount: number;
  /** Slices left and right of the core. */
  left: number;
  right: number;
  /** x where the left-most slice starts, and where the right group starts (the column after the core). */
  leftStart: number;
  rightStart: number;
  /** Slice 0's blocks, relative to its own x = 0. */
  template: PlacedBlock[];
  coreServes?: number;
  inputsPerSlice?: { key: ResourceKey; name: string; kind: 'item' | 'fluid'; amount: number };
}

export type GeneratedBuild = Build & { generated?: GeneratedLine };
