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
  const [top, side, bottom, front] = tex ?? [null, null, null, null];
  const facing = block.facing ?? 3;
  const faceTexture = (s: number) => (s === facing ? front ?? side : s === 1 ? top : s === 0 ? bottom : side);
  const [x, y, z] = block.pos;
  return (
    <mesh position={[x + 0.5, y + 0.5, z + 0.5]} userData={{ pos: block.pos }}>
      <boxGeometry args={[1, 1, 1]} />
      {FACE_ORDER.map((s, i) => {
        const map = faceTexture(s);
        const untexturedFront = !map && s === facing;
        return (
          <meshStandardMaterial
            key={i}
            attach={`material-${i}`}
            map={map ?? null}
            color={map ? '#ffffff' : untexturedFront ? '#f0f0f0' : entry.color}
          />
        );
      })}
    </mesh>
  );
}
