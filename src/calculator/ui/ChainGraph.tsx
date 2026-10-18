import {
  Background, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow,
  type Edge, type Node, type NodeChange, type NodeTypes, type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from '../../calc/chain';
import type { RecipeDb } from '../../recipes/db';
import type { ChainAction, ChainHistoryAction } from '../chainState';
import type { ScreenSolve } from '../drive';
import { formatRate } from '../format';
import { boxViews, nodeView, resourceInfo, screenEdges } from '../graphModel';
import { autoArrange } from '../layout';
import type { PickerMode } from '../picker';
import { GetBox } from './GetBox';
import { GraphContext } from './graphContext';
import { HaveBox } from './HaveBox';
import { NodeCard } from './NodeCard';

const nodeTypes: NodeTypes = { recipe: NodeCard, generator: NodeCard, have: HaveBox, get: GetBox };
/** Fitting stops at a readable zoom; a long line pans instead of shrinking. */
const FIT = { maxZoom: 1, minZoom: 0.8 };

export interface ChainGraphProps {
  /** False while another tab is showing: keys pressed there must not edit the graph. */
  active: boolean;
  chain: Chain;
  db: RecipeDb;
  /** The solve whose numbers are shown. */
  screen?: ScreenSolve;
  greyed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (a: ChainHistoryAction) => void;
  structural(actions: ChainAction[]): void;
  openPicker(mode: PickerMode): void;
}

function Graph({ active, chain, db, screen, greyed, canUndo, canRedo, dispatch, structural, openPicker }: ChainGraphProps) {
  const flow = useReactFlow();
  const result = screen?.result;
  const product = screen?.product?.key;
  const views = useMemo(
    () => chain.nodes.map((n) => nodeView(n, chain, db, result?.nodes.find((r) => r.id === n.id), product)),
    [chain, db, result, product],
  );
  const boxes = useMemo(() => boxViews(chain, db, screen), [chain, db, screen]);
  // Boxes not placed yet (e.g. from an older save) go where the auto-layout would put them.
  const fallback = useMemo(() => autoArrange(chain, db), [chain, db]);

  // React Flow keeps measured sizes and selection on its node objects; rebuild from the chain, keeping those.
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => {
    const at = (id: string) => chain.layout?.[id] ?? fallback[id] ?? { x: 0, y: 0 };
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      const keep = (n: Node): Node => ({ ...old.get(n.id), ...n });
      return [
        ...boxes.haves.map((h) => keep({ id: h.id, type: 'have', position: at(h.id), data: { have: h } })),
        ...chain.nodes.map((n, i) => keep({ id: n.id, type: n.kind, position: n.position, data: { view: views[i] } })),
        ...(boxes.get ? [keep({ id: boxes.get.id, type: 'get', position: at(boxes.get.id), deletable: false, data: { get: boxes.get, alsoMade: boxes.alsoMade } })] : []),
      ];
    });
  }, [chain, views, boxes, fallback]);

  // Bring a newly added machine into view (after React Flow has measured it).
  const count = useRef(chain.nodes.length);
  useEffect(() => {
    const grew = chain.nodes.length > count.current;
    count.current = chain.nodes.length;
    if (!grew) return;
    const h = setTimeout(() => flow.fitView({ duration: 200, ...FIT }), 50);
    return () => clearTimeout(h);
  }, [chain.nodes.length, flow]);

  const edges: Edge[] = useMemo(
    () =>
      screenEdges(chain, db, screen).map((e) => {
        const { name, kind } = resourceInfo(e.key, db);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.flow > 0 ? `${name} ${formatRate(e.flow, kind)}` : name,
          className: kind === 'fluid' ? 'edge-fluid' : 'edge-item',
        };
      }),
    [chain, db, screen],
  );

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type !== 'remove') continue;
      if (c.id.startsWith('have:')) dispatch({ type: 'removeHave', key: c.id.slice('have:'.length) });
      else if (!c.id.startsWith('get:')) dispatch({ type: 'removeNode', id: c.id });
    }
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns));
  };
  // One history entry per drag, however many boxes moved.
  const onNodeDragStop: OnNodeDrag = (_e, _node, moved) =>
    dispatch({ type: 'arrange', positions: Object.fromEntries(moved.map((n) => [n.id, n.position])) });

  const ctx = useMemo(() => ({ chain, db, dispatch, structural, greyed, openPicker }), [chain, db, dispatch, structural, greyed, openPicker]);
  return (
    <GraphContext.Provider value={ctx}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        deleteKeyCode={active ? ['Backspace', 'Delete'] : null}
        colorMode="dark"
        fitView
        fitViewOptions={FIT}
        minZoom={0.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Panel position="top-left" className="graph-toolbar">
          <button onClick={() => dispatch({ type: 'arrange', positions: autoArrange(chain, db) })} disabled={!chain.nodes.length}>Arrange</button>
          <button onClick={() => flow.fitView({ duration: 200, ...FIT })}>Fit</button>
          <button onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={() => dispatch({ type: 'redo' })} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
          <button disabled title="Coming next: turn this line into a 3D layout and schematic (project 2)">Build in 3D</button>
        </Panel>
      </ReactFlow>
    </GraphContext.Provider>
  );
}

export function ChainGraph(p: ChainGraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...p} />
    </ReactFlowProvider>
  );
}
