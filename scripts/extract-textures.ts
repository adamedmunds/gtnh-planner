/**
 * Copies the textures the catalog needs from your GregTech, Storage Drawers and Minecraft 1.7.10 jars into
 * public/textures/ (git-ignored).
 * Usage: npm run textures [-- --instance "<path to .minecraft>"]   (or set GTNH_INSTANCE, e.g. in .env)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { CATALOG_ENTRIES } from '../src/catalog';
import { loadLocalEnv } from './localEnv';
import { selectTextures, textureSource, wantedTexturePaths } from './textureSelect';

loadLocalEnv();
const argIdx = process.argv.indexOf('--instance');
const instance = argIdx !== -1 ? process.argv[argIdx + 1] : process.env.GTNH_INSTANCE;
if (!instance) {
  console.error(`No GTNH instance given.
Pass your instance's .minecraft folder: npm run textures -- --instance "<path>" (or set GTNH_INSTANCE, see .env.example).`);
  process.exit(1);
}
const modsDir = join(instance, 'mods');
let modFiles: string[];
try {
  modFiles = readdirSync(modsDir);
} catch {
  console.error(`Can't read ${modsDir}.
Pass your instance's .minecraft folder: npm run textures -- --instance "<path>" (or set GTNH_INSTANCE).`);
  process.exit(1);
}
const modJar = (pattern: RegExp) => {
  const name = modFiles.find((f) => pattern.test(f));
  return name ? join(modsDir, name) : undefined;
};
// Prism keeps the Minecraft jar in its libraries folder, three levels above the instance's .minecraft.
const minecraftJar = resolve(instance, '..', '..', '..', 'libraries', 'com', 'mojang', 'minecraft', '1.7.10', 'minecraft-1.7.10-client.jar');
const JARS = {
  gregtech: modJar(/^gregtech-.*\.jar$/i),
  storagedrawers: modJar(/^StorageDrawers-.*\.jar$/i),
  minecraft: existsSync(minecraftJar) ? minecraftJar : undefined,
};
if (!JARS.gregtech) {
  console.error(`No gregtech-*.jar found in ${modsDir}`);
  process.exit(1);
}

const wanted = wantedTexturePaths(CATALOG_ENTRIES);
const outRoot = resolve('public', 'textures');
for (const [jar, file] of Object.entries(JARS)) {
  const fromJar = wanted.filter((p) => textureSource(p).jar === jar);
  if (!fromJar.length) continue;
  if (!file) {
    console.warn(`No ${jar} jar found: ${fromJar.length} textures skipped (those blocks show plain colours)`);
    continue;
  }
  const paths = new Set(fromJar.flatMap((p) => [textureSource(p).path, `${textureSource(p).path}.mcmeta`]));
  const entries = unzipSync(new Uint8Array(readFileSync(file)), { filter: (f) => paths.has(f.name) });
  const { files, missing } = selectTextures(entries, fromJar);
  for (const [rel, data] of Object.entries(files)) {
    const target = join(outRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  console.log(`Extracted ${Object.keys(files).length} files from ${file} into ${outRoot}`);
  for (const m of missing) console.warn(`  missing in jar: ${m}`);
}
