import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatNumber, formatRate } from '../format';
import type { NodeView, ResourceRow } from '../graphModel';
import { useGraph } from './graphContext';
import { Icon } from './Icon';
import { RateInput } from './RateInput';
import { TierBadge } from './TierBadge';

export type CardNode = Node<{ view: NodeView }>;

function Row({ row }: { row: ResourceRow }) {
  const { openPicker, structural, dispatch } = useGraph();
  const has = (a: ResourceRow['actions'][number]) => row.actions.includes(a);
  return (
    <li data-testid="node-row" data-key={row.key}>
      <div className="node-row">
        <Icon k={row.key} name={row.name} px={18} />
        <span className={row.unmet && !row.external ? 'unmet' : ''}>{row.name}</span>
        <span className="num">{formatRate(row.rate, row.kind)}</span>
      </div>
      {row.actions.length > 0 && (
        <div className="row-actions">
          {has('make') && <button className="nodrag" data-testid="add-make" onClick={() => openPicker({ kind: 'makes', key: row.key })}>+ add what makes this</button>}
          {has('have') && <button className="nodrag" onClick={() => structural([{ type: 'setHave', key: row.key }])}>I have this</button>}
          {has('use') && <button className="nodrag" data-testid="add-use" onClick={() => openPicker({ kind: 'uses', key: row.key })}>+ use this in…</button>}
          {has('want') && <button className="nodrag" onClick={() => dispatch({ type: 'setWant', key: row.key })}>I want this</button>}
        </div>
      )}
    </li>
  );
}

/** A machine box: what it is, how many to build, what goes in and out. */
export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<CardNode>) {
  const { dispatch, greyed } = useGraph();
  const v = data.view;
  const machine = v.machineOptions.find((m) => m.mID === v.machineMID)?.name ?? `Machine ${v.machineMID}`;
  return (
    <div
      className={`node-card${v.invalid ? ' invalid' : ''}${greyed ? ' greyed' : ''}${selected ? ' selected' : ''}`}
      data-testid="node-card"
      data-node-id={v.id}
    >
      <Handle type="target" position={Position.Left} />
      <header>
        <Icon k={v.machineIcon} name={machine} px={24} />
        <b>{v.title}</b>
        <TierBadge tier={v.tier} />
        {v.approximate && <span className="tag" title="Multiblock or unknown voltage: worked out like a single block">≈</span>}
        <button className="x nodrag" title="Remove from the line" onClick={() => dispatch({ type: 'removeNode', id: v.id })}>×</button>
      </header>
      {v.kind === 'generator' && (
        <label className="node-gen-mode nodrag">
          Generators
          <select
            className="nodrag"
            aria-label="Generators"
            value={v.matchTiers ? 'match' : 'one'}
            onChange={(e) => dispatch({ type: 'setMatchTiers', id: v.id, on: e.target.value === 'match' })}
          >
            <option value="one">one tier</option>
            <option value="match">match each machine's voltage</option>
          </select>
        </label>
      )}
      <div className="node-machine">
        {!v.matchTiers && (
          <select
            className="nodrag"
            data-testid="machine-select"
            aria-label="Machine"
            value={v.machineMID}
            onChange={(e) => dispatch({ type: 'setMachine', id: v.id, machineMID: Number(e.target.value) })}
          >
            {v.machineOptions.map((m) => <option key={m.mID} value={m.mID}>{m.name}</option>)}
          </select>
        )}
        {v.overclock !== undefined && (
          <label className="nodrag" title="Overclock to the machine's tier">
            <input type="checkbox" checked={v.overclock} onChange={(e) => dispatch({ type: 'setOverclock', id: v.id, on: e.target.checked })} /> OC
          </label>
        )}
      </div>
      {v.invalid ? (
        <p className="node-invalid">{v.invalid}</p>
      ) : (
        <div className="node-count">
          <span className="big">×{v.build}</span>
          <span className="hint">{formatNumber(v.machines)} running · {formatRate(v.eut, 'eu')}</span>
          <label className="count-input" title="Type how many of these machines you have">
            {v.maxMachines !== undefined && <span aria-hidden>🔒</span>}
            have
            <RateInput
              value={v.maxMachines}
              allowBlank
              placeholder="any"
              label={`Machines of ${machine}`}
              onCommit={(max) => dispatch({ type: 'setMachineCap', id: v.id, max })}
            />
          </label>
        </div>
      )}
      {v.tierGenerators && (
        <ul className="node-rows tier-gens">
          {v.tierGenerators.map((t) => (
            <li key={t.tier} data-testid="tier-generator">
              <div className="node-row"><TierBadge tier={t.tier} /><span>{t.name}</span><span className="num">×{t.build}</span></div>
            </li>
          ))}
        </ul>
      )}
      {v.inputs.length > 0 && <ul className="node-rows">{v.inputs.map((r) => <Row key={r.key} row={r} />)}</ul>}
      {v.outputs.length > 0 && <ul className="node-rows out">{v.outputs.map((r) => <Row key={r.key} row={r} />)}</ul>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
