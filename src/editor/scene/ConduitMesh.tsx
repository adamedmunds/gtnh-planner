import { useMemo } from 'react';
import type { CatalogEntry } from '../../catalog';
import type { PlacedBlock } from '../../model/types';
import { textureCache, useAsync } from '../textures';
import { conduitBoxes, faceKinds } from './geometry';
import { boxGeometry, conduitMaterials } from './materials';

/** GT's cable insulation dye (Dyes.CABLE_INSULATION, 64/64/64). */
const INSULATION = '#404040';

/** Side (length) and end textures for a cable or pipe, already tinted the way GT tints them. */
function useConduitTextures(entry: CatalogEntry) {
  const t = entry.textures;
  return useAsync(() => {
    if (entry.kind === 'cable') {
      return Promise.all([
        textureCache.layered([{ rel: t.side, tint: INSULATION }]),
        textureCache.layered([{ rel: t.core, tint: entry.color }, { rel: t.end, tint: INSULATION }]),
      ]);
    }
    return Promise.all([
      textureCache.layered([{ rel: t.side, tint: entry.color }]),
      textureCache.layered([{ rel: t.end, tint: entry.color }]),
    ]);
  }, [entry.key]);
}

export function ConduitMesh({ block, entry, mask }: { block: PlacedBlock; entry: CatalogEntry; mask: number }) {
  const tex = useConduitTextures(entry);
  const boxes = useMemo(() => conduitBoxes(entry.thickness ?? 0.5, mask), [entry.thickness, mask]);

  const materials = conduitMaterials(entry, tex, entry.kind === 'cable' ? INSULATION : entry.color);

  const [x, y, z] = block.pos;
  return (
    <group position={[x, y, z]}>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          position={b.center}
          userData={{ pos: block.pos, arm: b.arm }}
          geometry={boxGeometry(b.size)}
          material={faceKinds(b, mask).map((k) => materials[k])}
          dispose={null}
        />
      ))}
    </group>
  );
}
