import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { CATALOG } from '../../catalog';
import { computeConnections } from '../../model/connections';
import { DIRS, addVec, posKey } from '../../model/directions';
import { placementFacing, type BlockMap } from '../../model/editing';
import { frameFor, shiftClickTarget } from '../interaction';
import type { Facing, Vec3 } from '../../model/types';
import { ConduitMesh } from './ConduitMesh';
import { MachineMesh } from './MachineMesh';
import { isClick, sideFromNormal } from './geometry';

export interface Hover { pos: Vec3; side: number; ground: boolean; arm?: number }

export interface SceneProps {
  blocks: BlockMap;
  layer: number | null;
  selectedKey: string;
  hover: Hover | null;
  /** Bump to re-frame the camera on the current build. */
  frameToken: number;
  onHover(h: Hover | null): void;
  onPlace(pos: Vec3, facing: Facing): void;
  onRemove(pos: Vec3): void;
  onToggleSide(pos: Vec3, side: number): void;
}

function hoverFromEvent(e: ThreeEvent<PointerEvent | MouseEvent>): Hover | null {
  const pos = e.object.userData.pos as Vec3 | undefined;
  const normal = e.face?.normal;
  if (!pos || !normal) return null;
  const side = sideFromNormal([normal.x, normal.y, normal.z]);
  const arm = e.object.userData.arm as number | undefined;
  return side < 0 ? null : { pos, side, ground: false, arm };
}

function groundHover(e: ThreeEvent<PointerEvent | MouseEvent>): Hover {
  return { pos: [Math.floor(e.point.x), -1, Math.floor(e.point.z)], side: 1, ground: true };
}

function Blocks(props: SceneProps) {
  const { camera } = useThree();
  const { blocks, layer } = props;
  const visible = useMemo(() => [...blocks.values()].filter((b) => layer === null || b.pos[1] <= layer), [blocks, layer]);
  const masks = useMemo(() => computeConnections([...blocks.values()]), [blocks]);

  const place = (h: Hover) => {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    props.onPlace(addVec(h.pos, DIRS[h.side]), placementFacing(h.side, [forward.x, forward.y, forward.z]));
  };

  const onBlockClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!isClick(e.delta)) return;
    const h = hoverFromEvent(e);
    if (!h) return;
    if (e.shiftKey) {
      // Shift+click only ever toggles connections; it never places.
      const target = shiftClickTarget(blocks, h);
      if (target) props.onToggleSide(target.pos, target.side);
      return;
    }
    place(h);
  };
  const onBlockContext = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    if (!isClick(e.delta)) return;
    const pos = e.object.userData.pos as Vec3 | undefined;
    if (pos) props.onRemove(pos);
  };

  return (
    <>
      <group
        onPointerMove={(e) => { e.stopPropagation(); props.onHover(hoverFromEvent(e)); }}
        onPointerOut={() => props.onHover(null)}
        onClick={onBlockClick}
        onContextMenu={onBlockContext}
      >
        {visible.map((b) => {
          const entry = CATALOG.get(b.key);
          if (!entry) {
            return (
              <mesh key={posKey(b.pos)} position={[b.pos[0] + 0.5, b.pos[1] + 0.5, b.pos[2] + 0.5]} userData={{ pos: b.pos }}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#ff00ff" />
              </mesh>
            );
          }
          return entry.kind === 'machine'
            ? <MachineMesh key={posKey(b.pos)} block={b} entry={entry} />
            : <ConduitMesh key={posKey(b.pos)} block={b} entry={entry} mask={masks.get(posKey(b.pos)) ?? 0} />;
        })}
      </group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => { e.stopPropagation(); props.onHover(groundHover(e)); }}
        onPointerOut={() => props.onHover(null)}
        onClick={(e) => { e.stopPropagation(); if (isClick(e.delta)) place(groundHover(e)); }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Ghost hover={props.hover} blocks={blocks} />
    </>
  );
}

/** Wireframe on the hovered block plus a translucent preview where the next block would go. */
function Ghost({ hover, blocks }: { hover: Hover | null; blocks: BlockMap }) {
  if (!hover) return null;
  const target = addVec(hover.pos, DIRS[hover.side]);
  const free = !blocks.has(posKey(target));
  return (
    <>
      {!hover.ground && (
        <mesh position={[hover.pos[0] + 0.5, hover.pos[1] + 0.5, hover.pos[2] + 0.5]} raycast={() => undefined}>
          <boxGeometry args={[1.02, 1.02, 1.02]} />
          <meshBasicMaterial color="#ffd54f" wireframe />
        </mesh>
      )}
      {free && (
        <mesh position={[target[0] + 0.5, target[1] + 0.5, target[2] + 0.5]} raycast={() => undefined}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#4fc3f7" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

/** Moves the camera and orbit target to fit the build whenever `frameToken` changes. */
function CameraRig({ blocks, frameToken }: { blocks: BlockMap; frameToken: number }) {
  const { camera, controls } = useThree();
  const latest = useRef(blocks);
  latest.current = blocks;
  useEffect(() => {
    if (frameToken === 0 || !controls) return;
    const f = frameFor(latest.current);
    if (!f) return;
    camera.position.set(...f.position);
    const orbit = controls as unknown as { target: THREE.Vector3; update(): void };
    orbit.target.set(...f.target);
    orbit.update();
  }, [frameToken, controls, camera]);
  return null;
}

export function Scene(props: SceneProps) {
  return (
    <Canvas camera={{ position: [10, 9, 12], fov: 50 }} onContextMenu={(e) => e.preventDefault()}>
      <color attach="background" args={['#1e2027']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[8, 12, 6]} intensity={1.1} />
      <Grid args={[200, 200]} cellSize={1} sectionSize={8} cellColor="#3a3d47" sectionColor="#555a66" infiniteGrid fadeDistance={80} />
      <Blocks {...props} />
      <CameraRig blocks={props.blocks} frameToken={props.frameToken} />
      <OrbitControls
        makeDefault
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
      />
    </Canvas>
  );
}
