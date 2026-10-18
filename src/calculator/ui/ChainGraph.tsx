import {
  Background, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow,
  type Edge, type NodeChange, type NodeTypes, type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from '../../calc/chain';
import type { ChainResult } from '../../calc/solve';
import type { RecipeDb } from '../../recipes/db';
import type { ChainHistoryAction } from '../chainState';
import type { PickerMode } from '../picker';
import { formatRate } from '../format';
import { chainEdges, nodeView, resourceInfo } from '../graphModel';
import { autoArrange } from '../layout';
import { GraphContext } from './graphContext';
import { NodeCard, type CardNode } from './NodeCard';

const nodeTypes: NodeTypes = { recipe: NodeCard, generator: NodeCard };

export interface ChainGraphProps {
  /** False while another tab is showing: keys pressed there must not edit the graph. */
  active: boolean;
  chain: Chain;
  db: RecipeDb;
  result?: ChainResult;
  greyed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (a: ChainHistoryAction) => void;
  openPicker(mode: PickerMode): void;
}

function Graph({ active, chain, db, result, greyed, canUndo, canRedo, dispatch, openPicker }: ChainGraphProps) {
  const flow = useReactFlow();
  const views = useMemo(
    () => chain.nodes.map((n) => nodeView(n, chain, db, result?.nodes.find((r) => r.id === n.id))),
    [chain, db, result],
  );

  // React Flow keeps measured sizes and selection on its node objects; rebuild from the chain, keeping those.
  const [nodes, setNodes] = useState<CardNode[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return chain.nodes.map((n, i) => ({ ...old.get(n.id), id: n.id, type: n.kind, position: n.position, data: { view: views[i] } }));
    });
  }, [chain, views]);

  // Bring a newly added node into view (after React Flow has measured it).
  const count = useRef(chain.nodes.length);
  useEffect(() => {
    const grew = chain.nodes.length > count.current;
    count.current = chain.nodes.length;
    if (!grew) return;
    const h = setTimeout(() => flow.fitView({ duration: 200, maxZoom: 1 }), 50);
    return () => clearTimeout(h);
  }, [chain.nodes.length, flow]);

  const edges: Edge[] = useMemo(
    () =>
      chainEdges(chain, db, result).map((e) => {
        const { name, kind } = resourceInfo(e.key, db);
        return { id: e.id, source: e.source, target: e.target, label: e.flow > 0 ? `${name} ${formatRate(e.flow, kind)}` : name };
      }),
    [chain, db, result],
  );

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    for (const c of changes) if (c.type === 'remove') dispatch({ type: 'removeNode', id: c.id });
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns));
  };
  // One history entry per drag, however many nodes moved.
  const onNodeDragStop: OnNodeDrag<CardNode> = (_e, _node, moved) =>
    dispatch({ type: 'arrange', positions: Object.fromEntries(moved.map((n) => [n.id, n.position])) });

  const ctx = useMemo(() => ({ chain, db, dispatch, greyed, openPicker }), [chain, db, dispatch, greyed, openPicker]);
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
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Panel position="top-left" className="graph-toolbar">
          <button onClick={() => dispatch({ type: 'arrange', positions: autoArrange(chain, db) })} disabled={!chain.nodes.length}>Auto-arrange</button>
          <button onClick={() => flow.fitView({ duration: 200 })}>Fit</button>
          <button onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={() => dispatch({ type: 'redo' })} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
          <button disabled title="Coming next: turn this chain into a 3D layout and schematic (project 2)">Build in 3D</button>
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
