import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSchematic } from '../src/export/schematic';
import { OIL_BERRY_LINE } from './oilBerryLine';

const { bytes, warnings, size } = buildSchematic(OIL_BERRY_LINE);
for (const w of warnings) console.warn(`warning: ${w}`);
mkdirSync(resolve('out'), { recursive: true });
const file = resolve('out', `${OIL_BERRY_LINE.name}.schematic`);
writeFileSync(file, bytes);
const counts = new Map<string, number>();
for (const b of OIL_BERRY_LINE.blocks) counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
console.log(`Wrote ${file} (${size.width}x${size.height}x${size.length})`);
for (const [k, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}x ${k}`);
