/** EU/t per amp for each GregTech tier (0 = ULV, 1 = LV, 2 = MV, ...), from GT `GTValues.V`. */
export const V: readonly number[] = [
  8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483647,
];

/** Lowest tier whose voltage covers `eutPerAmp`. */
export function tierForEut(eutPerAmp: number): number {
  const t = V.findIndex((v) => v >= eutPerAmp);
  return t === -1 ? V.length - 1 : t;
}

/** GTNH standard overclock: each step halves the duration (min 1 tick) and quadruples EU/t. */
export function overclock(eut: number, duration: number, overclocks: number): { eut: number; duration: number } {
  let e = eut;
  let d = duration;
  for (let i = 0; i < overclocks; i++) {
    e *= 4;
    d = Math.max(1, Math.floor(d / 2));
  }
  return { eut: e, duration: d };
}
