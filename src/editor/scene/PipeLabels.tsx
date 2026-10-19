import { useFrame } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { Icon } from '../../calculator/ui/Icon';
import type { LineNetwork, Vec3 } from '../../model/types';

export type LabelSpot = { net: string; pos: Vec3 };
/** Label elements by spot key, shared between the DOM layer and the in-canvas projector. */
export type LabelAnchors = MutableRefObject<Map<string, HTMLDivElement>>;

const spotKey = (s: LabelSpot) => `${s.net}@${s.pos.join(',')}`;

/**
 * Floating "what's in this pipe" icons above long pipe runs (power cables show the voltage). Plain DOM over the canvas
 * rather than drei's Html, which mounts a React root per label and breaks when they unmount mid-render.
 */
export function PipeLabelLayer({ spots, networks, anchors }: { spots: LabelSpot[]; networks: LineNetwork[]; anchors: LabelAnchors }) {
  const byId = new Map(networks.map((n) => [n.id, n]));
  return (
    <div className="pipe-label-layer">
      {spots.map((s) => {
        const n = byId.get(s.net);
        if (!n) return null;
        const key = spotKey(s);
        return (
          <div
            key={key}
            className="pipe-label"
            title={n.name}
            ref={(el) => {
              if (el) anchors.current.set(key, el);
              else anchors.current.delete(key);
            }}
          >
            {n.kind === 'power' ? <span className="volt">⚡{n.tier}</span> : <Icon k={n.icon ?? ''} name={n.name} px={20} />}
          </div>
        );
      })}
    </div>
  );
}

const v = new THREE.Vector3();

/** Inside the canvas: moves each label to its spot's place on screen, every frame. */
export function PipeLabelProjector({ spots, anchors }: { spots: LabelSpot[]; anchors: LabelAnchors }) {
  useFrame(({ camera, size }) => {
    for (const s of spots) {
      const el = anchors.current.get(spotKey(s));
      if (!el) continue;
      v.set(s.pos[0] + 0.5, s.pos[1] + 1.15, s.pos[2] + 0.5).project(camera);
      const behind = v.z > 1;
      el.style.display = behind ? 'none' : '';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });
  return null;
}

/** Translucent boxes over every block of the highlighted network. */
export function HighlightBoxes({ positions }: { positions: Vec3[] }) {
  return (
    <>
      {positions.map((p) => (
        <mesh key={p.join(',')} position={[p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]} raycast={() => null}>
          <boxGeometry args={[1.06, 1.06, 1.06]} />
          <meshBasicMaterial color="#4fc3f7" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
