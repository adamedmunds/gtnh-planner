import * as THREE from 'three';
import type { CatalogEntry } from '../../catalog';
import type { Vec3 } from '../../model/types';
import { FACE_ORDER } from './geometry';

// Shared GPU resources: every block of the same type (and facing) reuses one geometry and one set of
// materials instead of creating its own. They live for the whole session, so meshes pass dispose={null}.

const geometries = new Map<string, THREE.BoxGeometry>();
export function boxGeometry(size: Vec3): THREE.BoxGeometry {
  const key = size.join(',');
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = new THREE.BoxGeometry(size[0], size[1], size[2])));
  return g;
}

type MachineTextures = readonly (THREE.Texture | null)[] | undefined; // [top, side, bottom, front]
const machineSets = new Map<string, THREE.Material[]>();
/** `facing`: the face with the machine's picture; `output`: a separate output side, tinted so it can be seen. */
export function machineMaterials(entry: CatalogEntry, facing: number, tex: MachineTextures, output?: number): THREE.Material[] {
  const key = `${entry.key}|${facing}|${output ?? ''}|${tex ? 'tex' : 'flat'}`;
  let set = machineSets.get(key);
  if (!set) {
    const [top, side, bottom, front] = tex ?? [null, null, null, null];
    const faceTexture = (s: number) => (s === facing ? front ?? side : s === 1 ? top : s === 0 ? bottom : side);
    set = FACE_ORDER.map((s) => {
      const map = faceTexture(s);
      const untexturedFront = !map && s === facing;
      if (s === output && s !== facing) return new THREE.MeshStandardMaterial({ map: map ?? null, color: '#5ad1ff', emissive: '#0b3a52' });
      return new THREE.MeshStandardMaterial({ map: map ?? null, color: map ? '#ffffff' : untexturedFront ? '#f0f0f0' : entry.color });
    });
    machineSets.set(key, set);
  }
  return set;
}

const conduitSets = new Map<string, { side: THREE.Material; end: THREE.Material }>();
export function conduitMaterials(
  entry: CatalogEntry,
  tex: readonly (THREE.Texture | null)[] | undefined, // [side, end]
  fallback: string,
): { side: THREE.Material; end: THREE.Material } {
  const key = `${entry.key}|${tex ? 'tex' : 'flat'}`;
  let set = conduitSets.get(key);
  if (!set) {
    const [side, end] = tex ?? [null, null];
    const make = (map: THREE.Texture | null) =>
      new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : fallback, transparent: !!map, alphaTest: 0.1 });
    set = { side: make(side), end: make(end) };
    conduitSets.set(key, set);
  }
  return set;
}
