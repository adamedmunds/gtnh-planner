import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatNumber, formatRate } from '../format';
import type { GetView } from '../graphModel';
import type { RateRow } from '../overview';
import { useGraph } from './graphContext';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

export type GetNode = Node<{ get: GetView; alsoMade: RateRow[] }>;

/** "What I get": the product, with how much (typed, or as much as the line allows). */
export const GetBox = memo(function GetBox({ data, selected }: NodeProps<GetNode>) {
  const { dispatch } = useGraph();
  const g = data.get;
  const unit = g.kind === 'fluid' ? 'L/s' : '/s';
  return (
    <div className={`io-box get${g.provisional ? ' provisional' : ''}${selected ? ' selected' : ''}`} data-testid="get-box" data-key={g.key}>
      <Handle type="target" position={Position.Left} />
      <header><b>What I get</b></header>
      <div className="io-item"><Icon k={g.key} name={g.name} px={24} /> {g.name}</div>
      <div className="io-amount">
        <RateInput
          value={g.typed}
          allowBlank
          placeholder={formatNumber(g.rate)}
          label={`How much ${g.name} you want`}
          onCommit={(rate) => dispatch({ type: 'setWant', key: g.key, rate })}
        />
        {unit}
      </div>
      <div className="hint">{g.typed === undefined ? 'or type how much you want' : `making ${formatRate(g.rate, g.kind)}`}</div>
      {g.provisional && <button className="nodrag link" onClick={() => dispatch({ type: 'setWant', key: g.key })}>I want this</button>}
      {data.alsoMade.length > 0 && (
        <ul className="also">
          {data.alsoMade.map((r) => (
            <li key={r.key}>Also made: <Icon k={r.key} name={r.name} px={14} /> {r.name} {formatRate(r.rate, r.kind)}</li>
          ))}
        </ul>
      )}
    </div>
  );
});
