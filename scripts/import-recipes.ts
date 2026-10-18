/**
 * Imports a `/gtnhplanner dump` file into the planner.
 * Usage: npm run recipes [-- --dump "<path to recipes.json.gz>"]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { importDump } from '../src/recipes/importDump';

const DEFAULT_DUMP =
  'C:/Users/adam/AppData/Roaming/PrismLauncher/instances/export v2/.minecraft/gtnh-planner/recipes.json.gz';
const i = process.argv.indexOf('--dump');
const dumpPath = i !== -1 ? process.argv[i + 1] : process.env.GTNH_DUMP ?? DEFAULT_DUMP;
if (!existsSync(dumpPath)) {
  console.error(`No dump at ${dumpPath}\nRun /gtnhplanner dump in-game, or pass --dump "<path to recipes.json.gz>".`);
  process.exit(1);
}

const { data, warnings } = importDump(JSON.parse(strFromU8(gunzipSync(new Uint8Array(readFileSync(dumpPath))))));
const outDir = resolve('public', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'recipes.json.gz'), gzipSync(strToU8(JSON.stringify(data)), { level: 9 }));
const counts = { recipes: data.recipes.length, maps: data.maps.length, resources: data.resources.length, fuels: data.fuels.length };
writeFileSync(
  resolve(outDir, 'recipes-meta.json'),
  JSON.stringify({ gregtech: data.gregtech, dumpFormat: data.dumpFormat, exportedAt: data.exportedAt, counts }, null, 2),
);
console.log(`Imported dump format ${data.dumpFormat} (GregTech ${data.gregtech}) into public/data/`);
console.log(`  ${JSON.stringify(counts)}`);
if (warnings.length) console.warn(`  ${warnings.length} recipes skipped (first: ${warnings[0]})`);

// Icons from /gtnhplanner icons live next to the dump.
const iconsIn = join(dirname(dumpPath), 'icons');
const iconsOut = resolve(outDir, 'icons');
if (existsSync(join(iconsIn, 'icons.json'))) {
  rmSync(iconsOut, { recursive: true, force: true });
  mkdirSync(iconsOut, { recursive: true });
  const files = readdirSync(iconsIn).filter((f) => f.endsWith('.png') || f === 'icons.json');
  for (const f of files) copyFileSync(join(iconsIn, f), join(iconsOut, f));
  console.log(`  copied ${files.filter((f) => f.endsWith('.png')).length} icon sheets`);
} else {
  console.log('  no icons yet — run /gtnhplanner icons in game, then npm run recipes again');
}
