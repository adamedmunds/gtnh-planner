import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { CatalogEntry } from '../../catalog';
import type { PlacedBlock } from '../../model/types';
import { textureCache, useAsync } from '../textures';
import { conduitBoxes, faceKinds } from './geometry';

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

  // Shared materials for this block: one for the length, one for the ends; flat colour if textures are missing.
  const materials = useMemo(() => {
    const [side, end] = tex ?? [null, null];
    const fallback = entry.kind === 'cable' ? INSULATION : entry.color;
    const make = (map: THREE.Texture | null) =>
      new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : fallback, transparent: !!map, alphaTest: 0.1 });
    return { side: make(side), end: make(end) };
  }, [tex, entry.kind, entry.color]);
  useEffect(() => () => {
    materials.side.dispose();
    materials.end.dispose();
  }, [materials]);

  const [x, y, z] = block.pos;
  return (
    <group position={[x, y, z]}>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          position={b.center}
          userData={{ pos: block.pos }}
          material={faceKinds(b, mask).map((k) => materials[k])}
        >
          <boxGeometry args={b.size} />
        </mesh>
      ))}
    </group>
  );
}
