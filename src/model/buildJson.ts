import { registerMachines, type GeneratedMachine } from '../catalog';
import type { Build, FaceSetting, Facing, ManualMask, PlacedBlock } from './types';

export class BuildParseError extends Error {}

export function serializeBuild(build: Build): string {
  return JSON.stringify(build, null, 2);
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isMaskBits = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 63;

export function parseBuild(text: string): { build: Build; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BuildParseError('Not a valid JSON file');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || (raw as { version?: unknown }).version !== 1) {
    throw new BuildParseError('Unsupported build file (expected version 1)');
  }
  const obj = raw as { name?: unknown; blocks?: unknown; machines?: unknown; notes?: unknown; covers?: unknown; generated?: unknown };
  if (!Array.isArray(obj.blocks)) throw new BuildParseError('Build file has no blocks list');

  const warnings: string[] = [];
  const byPos = new Map<string, PlacedBlock>();
  obj.blocks.forEach((b: unknown, i: number) => {
    const rb = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>;
    const pos = rb.pos;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isInt)) {
      warnings.push(`Skipped block #${i + 1}: invalid position`);
      return;
    }
    if (typeof rb.key !== 'string' || rb.key === '') {
      warnings.push(`Skipped block #${i + 1}: missing block type`);
      return;
    }
    const block: PlacedBlock = { pos: [pos[0], pos[1], pos[2]], key: rb.key };
    if (typeof rb.role === 'string') block.role = rb.role;
    if (isInt(rb.mainFacing) && rb.mainFacing >= 2 && rb.mainFacing <= 5) block.mainFacing = rb.mainFacing as Facing;
    if (rb.facing !== undefined) {
      if (isInt(rb.facing) && rb.facing >= 0 && rb.facing <= 5) block.facing = rb.facing as Facing;
      else warnings.push(`Block #${i + 1}: ignored invalid facing`);
    }
    if (rb.manualMask !== undefined) {
      const m = rb.manualMask as Partial<ManualMask> | null;
      if (m && isMaskBits(m.forcedOn) && isMaskBits(m.forcedOff)) block.manualMask = { forcedOn: m.forcedOn, forcedOff: m.forcedOff };
      else warnings.push(`Block #${i + 1}: ignored invalid connection overrides`);
    }
    const key = block.pos.join(',');
    if (byPos.has(key)) {
      warnings.push(`Block #${i + 1} at ${key} replaces an earlier block in the same spot`);
      byPos.delete(key);
    }
    byPos.set(key, block);
  });

  const blocks = [...byPos.values()];
  const build: Build = { version: 1, name: typeof obj.name === 'string' ? obj.name : 'untitled', blocks };

  const machines: GeneratedMachine[] = [];
  (Array.isArray(obj.machines) ? obj.machines : []).forEach((m: unknown, i: number) => {
    const r = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    if (typeof r.key === 'string' && typeof r.name === 'string' && isInt(r.mID) && (r.tier === undefined || typeof r.tier === 'string')) {
      machines.push({ key: r.key, name: r.name, mID: r.mID, ...(typeof r.tier === 'string' ? { tier: r.tier } : {}) });
    } else warnings.push(`Skipped recipe machine #${i + 1}: invalid entry`);
  });
  if (machines.length) {
    build.machines = machines;
    registerMachines(machines);
  }
  if (Array.isArray(obj.notes) && obj.notes.every((n) => typeof n === 'string') && obj.notes.length) build.notes = obj.notes as string[];
  const covers = (Array.isArray(obj.covers) ? obj.covers : []).filter((c): c is FaceSetting => {
    const r = c as Record<string, unknown> | null;
    return !!r && Array.isArray(r.pos) && r.pos.length === 3 && r.pos.every(isInt) && isInt(r.side) && r.side >= 0 && r.side <= 5 &&
      (r.kind === 'pump' || r.kind === 'conveyor' || r.kind === 'inputFromOutput' || (r.kind === 'itemFilter' && typeof r.item === 'string'));
  });
  if (covers.length) build.covers = covers;
  // A generated line is only kept when it looks whole; otherwise the build is just blocks.
  const g = obj.generated as Record<string, unknown> | undefined;
  if (g && typeof g === 'object' && (g.style === 'modular' || g.style === 'straight') && Array.isArray(g.template) &&
      ['sliceLength', 'sliceCount', 'left', 'right', 'leftStart', 'rightStart'].every((k) => isInt(g[k]))) {
    build.generated = g as unknown as Build['generated'];
  }
  return { build, warnings };
}
