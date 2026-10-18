import type { Chain } from '../calc/chain';
import type { RecipeDb } from '../recipes/db';
import type { Resource, ResourceKey } from '../recipes/types';
import { screenProblems, type ScreenSolve } from './drive';
import { boxViews, machineName, nodeView, resourceInfo } from './graphModel';

export interface RateRow { key: ResourceKey; name: string; kind: Resource['kind']; rate: number }

/** The left panel of the simpler screen, in plain sections. */
export interface Summary {
  haves: RateRow[];
  gets: RateRow[];
  alsoMade: RateRow[];
  machines: { name: string; tier?: string; icon: ResourceKey; build: number; exact: number }[];
  power: { used: number; made: number; outside: number };
  problems: string[];
}

export function summary(chain: Chain, db: RecipeDb, screen?: ScreenSolve): Summary {
  const result = screen?.result;
  const boxes = boxViews(chain, db, screen);
  const haves = [...(result?.inputs ?? [])]
    .map(([key, rate]) => ({ key, ...resourceInfo(key, db), rate }))
    .sort((a, b) => b.rate - a.rate);
  const gets = boxes.get ? [{ key: boxes.get.key, name: boxes.get.name, kind: boxes.get.kind, rate: boxes.get.rate }] : [];

  const groups = new Map<string, Summary['machines'][number]>();
  for (const n of result?.nodes ?? []) {
    const node = chain.nodes.find((c) => c.id === n.id);
    if (!node || n.invalid || n.machines <= 1e-9) continue;
    const v = nodeView(node, chain, db);
    const name = machineName(node, db);
    const g = groups.get(name) ?? { name, ...(v.tier ? { tier: v.tier } : {}), icon: v.machineIcon, build: 0, exact: 0 };
    g.build += n.build;
    g.exact += n.machines;
    groups.set(name, g);
  }
  const used = result?.euUsed ?? 0;
  const made = result?.euMade ?? 0;
  return {
    haves,
    gets,
    alsoMade: boxes.alsoMade,
    machines: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    power: { used, made, outside: Math.max(0, used - made) },
    problems: screen ? screenProblems(screen, chain, db) : [],
  };
}
