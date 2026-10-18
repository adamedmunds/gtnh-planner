import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSchematic } from '../src/export/schematic';
import { TEST_LAYOUT } from './testLayout';

const { bytes, warnings, size } = buildSchematic(TEST_LAYOUT);
for (const w of warnings) console.warn(`warning: ${w}`);
const outDir = resolve('out');
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, `${TEST_LAYOUT.name}.schematic`);
writeFileSync(file, bytes);
console.log(`Wrote ${file} (${bytes.length} bytes, ${size.width}x${size.height}x${size.length}, ${TEST_LAYOUT.blocks.length} blocks)`);
