import type { CatalogEntry } from '../../catalog';
import type { PlacedBlock } from '../../model/types';
import { conduitBoxes } from './geometry';

const INSULATION = '#2b2b2b';

export function ConduitMesh({ block, entry, mask }: { block: PlacedBlock; entry: CatalogEntry; mask: number }) {
  const color = entry.kind === 'cable' ? INSULATION : entry.color;
  const [x, y, z] = block.pos;
  return (
    <group position={[x, y, z]}>
      {conduitBoxes(entry.thickness ?? 0.5, mask).map((b, i) => (
        <mesh key={i} position={b.center} userData={{ pos: block.pos }}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}
