import type { ResourceKey } from '../recipes/types';

export interface Position { x: number; y: number }

/** A recipe step, or a generator burning a fuel. Machine counts are solved; `maxMachines` caps them. */
export type ChainNode =
  | { id: string; kind: 'recipe'; recipeSig: string; machineMID: number; overclock: boolean; position: Position; maxMachines?: number }
  | { id: string; kind: 'generator'; fuelMap: string; fuelKey: ResourceKey; machineMID: number; position: Position; maxMachines?: number };

/** Produce `rate` per second of `key`, or as much as the limits allow. */
export type Target = { key: ResourceKey; rate: number } | { key: ResourceKey; maximise: true };

/** At most `maxRate` per second of `key` may come from outside the chain. */
export interface Limit { key: ResourceKey; maxRate: number }

export interface Chain {
  version: 1;
  nodes: ChainNode[];
  targets: Target[];
  limits: Limit[];
  /** Resources the user buys in: no "unmet input" warning. */
  externals: ResourceKey[];
  /** Positions of the graph's have/get boxes, keyed `have:<key>` / `get:<key>`. */
  layout?: Record<string, Position>;
}

export const emptyChain = (): Chain => ({ version: 1, nodes: [], targets: [], limits: [], externals: [] });
