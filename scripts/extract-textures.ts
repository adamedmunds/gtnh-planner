/**
 * Copies the textures the catalog needs from your GregTech jar into public/textures/ (git-ignored).
 * Usage: npm run textures [-- --instance "<path to .minecraft>"]   (or set GTNH_INSTANCE)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { CATALOG_ENTRIES } from '../src/catalog';
import { JAR_TEXTURE_ROOT, selectTextures, wantedTexturePaths } from './textureSelect';

const DEFAULT_INSTANCE =
  'C:\\Users\\adam\\AppData\\Roaming\\PrismLauncher\\instances\\GT_New_Horizons_2.9.0-RC-1_Java_17-26\\.minecraft';
const argIdx = process.argv.indexOf('--instance');
const instance = argIdx !== -1 ? process.argv[argIdx + 1] : process.env.GTNH_INSTANCE ?? DEFAULT_INSTANCE;
const modsDir = join(instance, 'mods');
let modFiles: string[];
try {
  modFiles = readdirSync(modsDir);
} catch {
  console.error(`Can't read ${modsDir}.
Pass your instance's .minecraft folder: npm run textures -- --instance "<path>" (or set GTNH_INSTANCE).`);
  process.exit(1);
}
const jarName = modFiles.find((f) => /^gregtech-.*\.jar$/i.test(f));
if (!jarName) {
  console.error(`No gregtech-*.jar found in ${modsDir}`);
  process.exit(1);
}

const wanted = wantedTexturePaths(CATALOG_ENTRIES);
const wantedJarPaths = new Set(wanted.flatMap((p) => [JAR_TEXTURE_ROOT + p, `${JAR_TEXTURE_ROOT}${p}.mcmeta`]));
const entries = unzipSync(new Uint8Array(readFileSync(join(modsDir, jarName))), {
  filter: (f) => wantedJarPaths.has(f.name),
});
const { files, missing } = selectTextures(entries, wanted);

const outRoot = resolve('public', 'textures');
for (const [rel, data] of Object.entries(files)) {
  const target = join(outRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}
console.log(`Extracted ${Object.keys(files).length} files from ${jarName} into ${outRoot}`);
for (const m of missing) console.warn(`  missing in jar: ${m}`);
