import { gzipSync } from 'fflate';
import { CATALOG, GT_BLOCK_NAME, type Catalog, type CatalogEntry } from '../catalog';
import { computeConnections } from '../model/connections';
import { posKey } from '../model/directions';
import type { Build, PlacedBlock } from '../model/types';
import {
  byte, byteArray, compound, encodeNbt, int, list, short, str, type CompoundTag,
} from './nbt';

export const DEFAULT_FACING = 3;
const GT_LOCAL_ID = 1;
const MAX_DIM = 32767;
/** 256³ cells. Larger schematics would need multi-GB arrays here and in Schematica. */
const MAX_VOLUME = 256 ** 3;

export interface SchematicSize { width: number; height: number; length: number }

interface Resolved { block: PlacedBlock; entry: CatalogEntry }

export function buildSchematicTag(
  build: Build,
  catalog: Catalog = CATALOG,
): { tag: CompoundTag; warnings: string[]; size: SchematicSize } {
  const warnings: string[] = [];

  // Resolve catalog entries; last block at a position wins.
  const byPos = new Map<string, Resolved>();
  for (const block of build.blocks) {
    const entry = catalog.get(block.key);
    if (!entry) {
      warnings.push(`Skipped unknown block "${block.key}" at ${posKey(block.pos)}`);
      continue;
    }
    if (entry.notInSchematic) continue;
    const key = posKey(block.pos);
    if (byPos.has(key)) warnings.push(`Duplicate blocks at ${key}; kept the last one`);
    byPos.set(key, { block, entry });
  }
  const cells = [...byPos.values()];
  if (cells.length === 0) throw new Error('Build is empty');

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { block } of cells) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], block.pos[a]);
      max[a] = Math.max(max[a], block.pos[a]);
    }
  }
  const size: SchematicSize = {
    width: max[0] - min[0] + 1,
    height: max[1] - min[1] + 1,
    length: max[2] - min[2] + 1,
  };
  const volume = size.width * size.height * size.length;
  if (size.width > MAX_DIM || size.height > MAX_DIM || size.length > MAX_DIM || volume > MAX_VOLUME) {
    throw new Error(
      `Build is too large for a schematic: blocks span ${min.join(',')} to ${max.join(',')} ` +
        `(${size.width}x${size.height}x${size.length}). Check for stray blocks far from the rest.`,
    );
  }

  const blocks = new Uint8Array(volume);
  const data = new Uint8Array(volume);
  const connections = computeConnections(cells.map((c) => c.block), catalog);
  const tileEntities: CompoundTag[] = [];
  // Markers are plain vanilla blocks with their own local ids after GregTech's.
  const vanillaIds = new Map<string, number>();
  for (const { entry } of cells) if (entry.vanilla && !vanillaIds.has(entry.vanilla)) vanillaIds.set(entry.vanilla, GT_LOCAL_ID + 1 + vanillaIds.size);

  for (const { block, entry } of cells) {
    const x = block.pos[0] - min[0];
    const y = block.pos[1] - min[1];
    const z = block.pos[2] - min[2];
    if (entry.meta > 255) throw new Error(`${entry.name} has block metadata ${entry.meta}; a schematic holds 0-255`);
    const index = x + (y * size.length + z) * size.width;
    if (entry.vanilla) {
      blocks[index] = vanillaIds.get(entry.vanilla)!;
      data[index] = entry.meta;
      // A drawer as a placed one saves it: its front, capacity in stacks (GTNH's StorageDrawers.cfg: 64) and one empty
      // slot. Without these it loads facing down with no room.
      if (entry.drawer) {
        tileEntities.push(compound({
          x: int(x), y: int(y), z: int(z), id: str('StorageDrawers:tileDrawersStandard'),
          Dir: byte(block.facing !== undefined && block.facing >= 2 ? block.facing : DEFAULT_FACING), Cap: int(64),
          Slots: list('compound', [compound({})]),
        }));
      }
      continue;
    }
    blocks[index] = GT_LOCAL_ID;
    data[index] = entry.meta;

    const te: CompoundTag = compound({ x: int(x), y: int(y), z: int(z) });
    // Markers that aren't another mod's block are GT machines (the Super Tank).
    if (entry.kind === 'machine' || entry.kind === 'marker') {
      te.value.id = str('BaseMetaTileEntity');
      te.value.mID = int(entry.mID);
      te.value.mFacing = short(block.facing ?? DEFAULT_FACING);
      // GT stores "allowed to work" inverted; a transformer that isn't allowed to work steps up.
      if (block.stepUp) te.value.mWorks = byte(1);
      // An output hatch locked to its fluid (MTEHatchOutput.saveNBTData/loadNBTData): mode 9 is "that fluid only", and
      // the name is the Forge fluid registry name, which is what the recipe dump keys fluids by (`fluid:<name>`).
      const port = block.port;
      if (port?.kind === 'out' && port.locked && port.keys.length === 1 && port.keys[0].startsWith('fluid:')) {
        te.value.mMode = byte(9);
        te.value.lockedFluidName = str(port.keys[0].slice('fluid:'.length));
      }
      // GT basic machines keep their front separately; without it they load with the front on the output side.
      if (block.mainFacing !== undefined) {
        te.value.mMainFacing = int(block.mainFacing);
        // GT reads a missing flag as off. Input from the output side only where the build relies on it (a machine could
        // otherwise pull back in what its output pipe carries); auto-output on, as the line notes ask.
        const fromOutput = (build.covers ?? []).some((c) => c.kind === 'inputFromOutput' && posKey(c.pos) === posKey(block.pos));
        te.value.mAllowInputFromOutputSide = byte(fromOutput ? 1 : 0);
        te.value.mItemTransfer = byte(1);
        te.value.mFluidTransfer = byte(1);
      }
    } else {
      const mask = connections.get(posKey(block.pos)) ?? 0;
      te.value.id = str('BaseMetaPipeEntity');
      te.value.mID = int(entry.mID);
      // NBT bytes are signed; bit 7 is never set for a 6-bit mask.
      te.value.mConnections = byte(mask);
    }
    tileEntities.push(te);
  }

  const tag = compound({
    Width: short(size.width),
    Height: short(size.height),
    Length: short(size.length),
    Materials: str('Alpha'),
    Blocks: byteArray(blocks),
    Data: byteArray(data),
    SchematicaMapping: compound({
      'minecraft:air': short(0),
      [GT_BLOCK_NAME]: short(GT_LOCAL_ID),
      ...Object.fromEntries([...vanillaIds].map(([name, id]) => [name, short(id)])),
    }),
    Entities: list('compound', []),
    TileEntities: list('compound', tileEntities),
  });
  return { tag, warnings, size };
}

export function buildSchematic(
  build: Build,
  catalog: Catalog = CATALOG,
): { bytes: Uint8Array; warnings: string[]; size: SchematicSize } {
  const { tag, warnings, size } = buildSchematicTag(build, catalog);
  return { bytes: gzipSync(encodeNbt(tag, 'Schematic')), warnings, size };
}
