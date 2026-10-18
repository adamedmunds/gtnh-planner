import { emptyChain, type Chain, type ChainNode, type Limit, type Target } from '../calc/chain';
import { BuildParseError, parseBuild } from '../model/buildJson';
import type { Build } from '../model/types';

/** Everything the planner saves: the 3D build and the calculator chain. */
export interface Project {
  version: 2;
  build: Build;
  chain: Chain;
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function position(v: unknown): { x: number; y: number } {
  return isObj(v) && isNum(v.x) && isNum(v.y) ? { x: v.x, y: v.y } : { x: 0, y: 0 };
}

function parseNode(v: unknown): ChainNode | undefined {
  if (!isObj(v) || !isStr(v.id) || !isInt(v.machineMID)) return undefined;
  if (v.kind === 'recipe' && isStr(v.recipeSig)) {
    return { id: v.id, kind: 'recipe', recipeSig: v.recipeSig, machineMID: v.machineMID, overclock: v.overclock === true, position: position(v.position) };
  }
  if (v.kind === 'generator' && isStr(v.fuelMap) && isStr(v.fuelKey)) {
    return { id: v.id, kind: 'generator', fuelMap: v.fuelMap, fuelKey: v.fuelKey, machineMID: v.machineMID, position: position(v.position) };
  }
  return undefined;
}

function parseTarget(v: unknown): Target | undefined {
  if (!isObj(v) || !isStr(v.key)) return undefined;
  if (v.maximise === true) return { key: v.key, maximise: true };
  if (isNum(v.rate) && v.rate > 0) return { key: v.key, rate: v.rate };
  return undefined;
}

function parseLimit(v: unknown): Limit | undefined {
  return isObj(v) && isStr(v.key) && isNum(v.maxRate) && v.maxRate >= 0 ? { key: v.key, maxRate: v.maxRate } : undefined;
}

/** Reads a saved chain, skipping invalid entries with warnings. */
export function parseChain(raw: unknown, warnings: string[]): Chain {
  if (!isObj(raw)) return emptyChain();
  const list = <T>(items: unknown, parse: (v: unknown) => T | undefined, what: string): T[] => {
    const out: T[] = [];
    (Array.isArray(items) ? items : []).forEach((v, i) => {
      const p = parse(v);
      if (p) out.push(p);
      else warnings.push(`Skipped invalid ${what} #${i + 1}`);
    });
    return out;
  };
  return {
    version: 1,
    nodes: list(raw.nodes, parseNode, 'chain node'),
    targets: list(raw.targets, parseTarget, 'target'),
    limits: list(raw.limits, parseLimit, 'supply limit'),
    externals: Array.isArray(raw.externals) ? raw.externals.filter(isStr) : [],
  };
}

/** Loads a project file, or a build-only (version 1) file with an empty chain. */
export function parseProject(text: string): { project: Project; warnings: string[]; fromVersion: 1 | 2 } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BuildParseError('Not a valid JSON file');
  }
  if (isObj(raw) && raw.version === 1) {
    const { build, warnings } = parseBuild(text);
    return { project: { version: 2, build, chain: emptyChain() }, warnings, fromVersion: 1 };
  }
  if (!isObj(raw) || raw.version !== 2) throw new BuildParseError('Unsupported project file (expected version 1 or 2)');
  const { build, warnings } = parseBuild(JSON.stringify(raw.build ?? null));
  const chain = parseChain(raw.chain, warnings);
  return { project: { version: 2, build, chain }, warnings, fromVersion: 2 };
}
