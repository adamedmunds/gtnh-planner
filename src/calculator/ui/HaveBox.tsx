import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatNumber, formatRate } from '../format';
import type { HaveView } from '../graphModel';
import { useGraph } from './graphContext';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

export type HaveNode = Node<{ have: HaveView }>;

/** "What I have": an input you supply, with how much (blank: as much as the line needs). */
export const HaveBox = memo(function HaveBox({ data, selected }: NodeProps<HaveNode>) {
  const { dispatch, openPicker } = useGraph();
  const h = data.have;
  const unit = h.kind === 'fluid' ? 'L/s' : '/s';
  return (
    <div className={`io-box have${selected ? ' selected' : ''}`} data-testid="have-box" data-key={h.key}>
      <header>
        <b>What I have</b>
        <button className="x nodrag" title="Remove" onClick={() => dispatch({ type: 'removeHave', key: h.key })}>×</button>
      </header>
      <div className="io-item"><Icon k={h.key} name={h.name} px={24} /> {h.name}</div>
      <div className="io-amount">
        <RateInput
          value={h.amount}
          allowBlank
          placeholder={formatNumber(h.used)}
          label={`How much ${h.name} you have`}
          onCommit={(amount) => dispatch({ type: 'setHave', key: h.key, amount })}
        />
        {unit}
      </div>
      <div className="hint">
        {h.amount === undefined ? `type how much you have · using ${formatRate(h.used, h.kind)}` : `using ${formatRate(h.used, h.kind)}`}
      </div>
      <button className="nodrag link" onClick={() => openPicker({ kind: 'uses', key: h.key })}>+ use this in…</button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
