import type { Build, Facing, ManualMask, PlacedBlock } from './types';

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
  const obj = raw as { name?: unknown; blocks?: unknown };
  if (!Array.isArray(obj.blocks)) throw new BuildParseError('Build file has no blocks list');

  const warnings: string[] = [];
  const blocks: PlacedBlock[] = [];
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
    if (rb.facing !== undefined) {
      if (isInt(rb.facing) && rb.facing >= 0 && rb.facing <= 5) block.facing = rb.facing as Facing;
      else warnings.push(`Block #${i + 1}: ignored invalid facing`);
    }
    if (rb.manualMask !== undefined) {
      const m = rb.manualMask as Partial<ManualMask> | null;
      if (m && isMaskBits(m.forcedOn) && isMaskBits(m.forcedOff)) block.manualMask = { forcedOn: m.forcedOn, forcedOff: m.forcedOff };
      else warnings.push(`Block #${i + 1}: ignored invalid connection overrides`);
    }
    blocks.push(block);
  });

  return { build: { version: 1, name: typeof obj.name === 'string' ? obj.name : 'untitled', blocks }, warnings };
}
