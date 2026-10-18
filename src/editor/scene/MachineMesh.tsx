import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { CatalogEntry } from '../../catalog';
import type { PlacedBlock } from '../../model/types';
import { textureCache, useAsync } from '../textures';
import { FACE_ORDER } from './geometry';

export function MachineMesh({ block, entry }: { block: PlacedBlock; entry: CatalogEntry }) {
  const t = entry.textures;
  const tex = useAsync(
    () => Promise.all([textureCache.get(t.top), textureCache.get(t.side), textureCache.get(t.bottom), textureCache.composite(t.side, t.front)]),
    [entry.key],
  );
  const facing = block.facing ?? 3;

  // One material per box face (BoxGeometry order +x, -x, +y, -y, +z, -z), passed as an array: attaching
  // "material-N" children does not work because a mesh starts with a single material, not an array.
  const materials = useMemo(() => {
    const [top, side, bottom, front] = tex ?? [null, null, null, null];
    const faceTexture = (s: number) => (s === facing ? front ?? side : s === 1 ? top : s === 0 ? bottom : side);
    return FACE_ORDER.map((s) => {
      const map = faceTexture(s);
      const untexturedFront = !map && s === facing;
      return new THREE.MeshStandardMaterial({
        map: map ?? null,
        color: map ? '#ffffff' : untexturedFront ? '#f0f0f0' : entry.color,
      });
    });
  }, [tex, facing, entry.color]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  const [x, y, z] = block.pos;
  return (
    <mesh position={[x + 0.5, y + 0.5, z + 0.5]} userData={{ pos: block.pos }} material={materials}>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}
