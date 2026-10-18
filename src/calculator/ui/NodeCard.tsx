import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo } from 'react';
import { formatNumber, formatRate } from '../format';
import type { NodeView, ResourceRow } from '../graphModel';
import { useGraph } from './graphContext';
import { useResourceMenu } from './ResourceMenu';

export type CardNode = Node<{ view: NodeView }>;

function Row({ row }: { row: ResourceRow }) {
  const openMenu = useResourceMenu();
  const { openPicker } = useGraph();
  return (
    <li data-testid="node-row" data-key={row.key} onContextMenu={(e) => openMenu(e, row.key)}>
      <div className="node-row">
        <span className={row.unmet && !row.external ? 'unmet' : ''}>{row.name}</span>
        <span className="num">{formatRate(row.rate, row.kind)}</span>
        <button className="more nodrag" aria-label={`Options for ${row.name}`} title="Target, supply limit, bought in" onClick={(e) => openMenu(e, row.key)}>⋯</button>
      </div>
      {(row.actions.includes('make') || row.actions.includes('use')) && (
        <div className="row-actions">
          {row.actions.includes('make') && (
            <button className="nodrag" data-testid="add-make" onClick={() => openPicker({ kind: 'makes', key: row.key })}>+ add what makes this</button>
          )}
          {row.actions.includes('use') && (
            <button className="nodrag" data-testid="add-use" onClick={() => openPicker({ kind: 'uses', key: row.key })}>+ use this in…</button>
          )}
        </div>
      )}
    </li>
  );
}

export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<CardNode>) {
  const { dispatch, greyed } = useGraph();
  const v = data.view;
  return (
    <div
      className={`node-card${v.invalid ? ' invalid' : ''}${greyed ? ' greyed' : ''}${selected ? ' selected' : ''}`}
      data-testid="node-card"
      data-node-id={v.id}
    >
      <Handle type="target" position={Position.Left} />
      <header>
        <b>{v.title}</b>
        {v.approximate && <span className="tag" title="Multiblock or unknown voltage: calculated like a single block">≈</span>}
        <button className="x nodrag" title="Remove from chain" onClick={() => dispatch({ type: 'removeNode', id: v.id })}>×</button>
      </header>
      <div className="node-machine">
        <select
          className="nodrag"
          data-testid="machine-select"
          aria-label="Machine"
          value={v.machineMID}
          onChange={(e) => dispatch({ type: 'setMachine', id: v.id, machineMID: Number(e.target.value) })}
        >
          {v.machineOptions.map((m) => <option key={m.mID} value={m.mID}>{m.name}</option>)}
        </select>
        {v.overclock !== undefined && (
          <label className="nodrag" title="Overclock to the machine's tier">
            <input type="checkbox" checked={v.overclock} onChange={(e) => dispatch({ type: 'setOverclock', id: v.id, on: e.target.checked })} /> OC
          </label>
        )}
      </div>
      {v.invalid ? (
        <p className="node-invalid">{v.invalid}</p>
      ) : (
        <p className="node-stats">
          <b>{v.build}</b> to build · {formatNumber(v.machines)} running · {formatRate(v.eut, 'eu')}
        </p>
      )}
      {v.inputs.length > 0 && <ul className="node-rows">{v.inputs.map((r) => <Row key={r.key} row={r} />)}</ul>}
      {v.outputs.length > 0 && (
        <ul className="node-rows out">{v.outputs.map((r) => <Row key={r.key} row={r} />)}</ul>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
