import type { Resource } from '../recipes/types';

/** 4 significant figures with thousands separators; never an exponent or "-0". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1e-9) return '0';
  return Number(n.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 12 });
}

const UNIT: Record<Resource['kind'], string> = { item: '/s', fluid: ' L/s', eu: ' EU/t' };

export function formatRate(n: number, kind: Resource['kind']): string {
  return `${formatNumber(n)}${UNIT[kind]}`;
}

/** A typed rate: finite and positive (or zero with `allowZero`), else undefined. */
export function parseRateInput(text: string, { allowZero = false } = {}): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 || (allowZero && n === 0) ? n : undefined;
}
