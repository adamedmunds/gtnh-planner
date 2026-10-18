/**
 * Usage:
 *   npm run schematic:oil                                   # default: 6 extractors, 17 distilleries
 *   npm run schematic:oil -- --berries 8.4                  # size for a berry rate
 *   npm run schematic:oil -- --extractors 9 --distilleries 26
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSchematic } from '../src/export/schematic';
import { countsForBerryRate, makeOilBerryLine, type OilBerryLineOptions } from '../src/presets/oilBerryLine';

function parseArgs(argv: string[]): OilBerryLineOptions {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v)) throw new Error(`--${name} needs a number`);
    return v;
  };
  const berries = flag('berries');
  const base = berries !== undefined ? countsForBerryRate(berries) : { extractors: 6, distilleries: 17 };
  return { extractors: flag('extractors') ?? base.extractors, distilleries: flag('distilleries') ?? base.distilleries };
}

const opts = parseArgs(process.argv.slice(2));
const build = makeOilBerryLine(opts);
const { bytes, warnings, size } = buildSchematic(build);
for (const w of warnings) console.warn(`warning: ${w}`);
mkdirSync(resolve('out'), { recursive: true });
const file = resolve('out', `${build.name}.schematic`);
writeFileSync(file, bytes);

// Throughput and power estimate (LV recipes from the planning notes; MV combustion gen 90% efficient,
// light fuel 305 EU/L).
const { extractors: e, distilleries: d } = opts;
const oil = 100 * e;
const distillCap = (50 / 1.5) * d;
const fuelOut = Math.min(oil, distillCap);
// One generator per module, plus the MV electrolyzer's own generator.
const generators = Math.ceil(e / 3) + Math.ceil(d / 3) + 1 + 1;
// Chemical reactor: 12,000 L per 160 t (30 EU/t). MV electrolyzer: one H2S cell per reactor batch, 72 t at 120 EU/t.
const batchesPerSecond = fuelOut / 12000;
const reactorEu = 30 * Math.min(1, batchesPerSecond * 8);
const electrolyzerEu = 120 * Math.min(1, batchesPerSecond * 3.6);
const euPerTick =
  30 * e * Math.min(1, distillCap / oil) + 24 * d * Math.min(1, oil / distillCap) + reactorEu + electrolyzerEu;
const burn = (euPerTick / (305 * 0.9)) * 20;

const counts = new Map<string, number>();
for (const b of build.blocks) counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
console.log(`Wrote ${file} (${size.width}x${size.height}x${size.length})`);
for (const [k, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}x ${k}`);
const distillBerries = distillCap / 100;
console.log(`\nExtractors keep up with ${e} berries/s; distilleries keep up with ${distillBerries.toFixed(2)} berries/s.`);
if (distillBerries < e - 1e-6) {
  console.log(`  Above ${distillBerries.toFixed(2)} berries/s the distilleries limit output (${e * 3 - d} more would match the extractors).`);
} else if (distillCap - oil >= 50 / 1.5) console.log(`  ${Math.floor((distillCap - oil) / (50 / 1.5))} distilleries will sit idle.`);
console.log(`Light fuel: ${fuelOut.toFixed(0)} L/s made, ~${burn.toFixed(0)} L/s burned by ${generators} MV generators (~${euPerTick.toFixed(0)} EU/t), ~${(fuelOut - burn).toFixed(0)} L/s net.`);
