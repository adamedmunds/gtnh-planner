import type { CatalogEntry } from '../../catalog';
import type { PlacedBlock } from '../../model/types';
import { textureCache, useAsync } from '../textures';
import { boxGeometry, machineMaterials } from './materials';

const UNIT: [number, number, number] = [1, 1, 1];

export function MachineMesh({ block, entry }: { block: PlacedBlock; entry: CatalogEntry }) {
  const t = entry.textures;
  const tex = useAsync(
    () => Promise.all([textureCache.get(t.top), textureCache.get(t.side), textureCache.get(t.bottom), textureCache.composite(t.side, t.front)]),
    [entry.key],
  );
  const [x, y, z] = block.pos;
  return (
    <mesh
      position={[x + 0.5, y + 0.5, z + 0.5]}
      userData={{ pos: block.pos }}
      geometry={boxGeometry(UNIT)}
      material={machineMaterials(entry, block.facing ?? 3, tex)}
      dispose={null}
    />
  );
}
