import { readFileSync } from 'node:fs';
import { decodeNbt } from '../src/export/nbtRead';
import type { CompoundTag, Tag } from '../src/export/nbt';
import { CATALOG_ENTRIES } from '../src/catalog';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run schematic:inspect -- <file.schematic>');
  process.exit(1);
}
const { name, root } = decodeNbt(new Uint8Array(readFileSync(file)));
const val = (t: Tag | undefined) => (t && 'value' in t ? t.value : undefined);
console.log(`root "${name}"  ${val(root.value.Width)}x${val(root.value.Height)}x${val(root.value.Length)}  Materials=${val(root.value.Materials)}`);
const mapping = root.value.SchematicaMapping as CompoundTag | undefined;
console.log('mapping:', mapping ? Object.fromEntries(Object.entries(mapping.value).map(([k, t]) => [k, val(t)])) : 'none');
const nameById = new Map(CATALOG_ENTRIES.map((e) => [e.mID, e.name]));
const tes = (root.value.TileEntities as { value: CompoundTag[] }).value;
for (const te of tes) {
  const v = te.value;
  const extra = v.mFacing ? `facing=${val(v.mFacing)}` : `conn=0b${Number(val(v.mConnections)).toString(2).padStart(6, '0')}`;
  console.log(`  (${val(v.x)},${val(v.y)},${val(v.z)}) ${val(v.id)} mID=${val(v.mID)} ${nameById.get(Number(val(v.mID))) ?? '?'} ${extra}`);
}
console.log(`${tes.length} tile entities`);
