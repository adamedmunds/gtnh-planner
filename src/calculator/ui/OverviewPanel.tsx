import { formatNumber, formatRate } from '../format';
import type { Overview, RateRow } from '../overview';
import { useResourceMenu } from './ResourceMenu';

function Rows({ rows, testId, empty }: { rows: RateRow[]; testId: string; empty: string }) {
  const openMenu = useResourceMenu();
  return (
    <ul className="rows" data-testid={testId}>
      {rows.length === 0 && <li className="hint">{empty}</li>}
      {rows.map((r) => (
        <li key={r.key} onContextMenu={(e) => openMenu(e, r.key)}>
          <span>{r.name}</span>
          <span className="num">{formatRate(r.rate, r.kind)}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPanel({ o, greyed, solving }: { o: Overview; greyed: boolean; solving: boolean }) {
  return (
    <aside className={`panel overview${greyed ? ' greyed' : ''}`} aria-busy={solving}>
      {o.problems.length > 0 && (
        <>
          <h3>Problems</h3>
          <ul className="problems" data-testid="overview-problems">
            {o.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </>
      )}
      <h3>Outputs</h3>
      <Rows rows={o.outputs} testId="overview-outputs" empty="Set a target to see outputs." />
      <h3>Inputs</h3>
      <Rows rows={o.inputs} testId="overview-inputs" empty="None" />
      <h3>Byproducts</h3>
      <Rows rows={o.byproducts} testId="overview-byproducts" empty="None" />
      <h3>Machines</h3>
      <ul className="rows" data-testid="overview-machines">
        {o.machines.length === 0 && <li className="hint">None yet</li>}
        {o.machines.map((m) => (
          <li key={m.name}>
            <span>{m.build}× {m.name}</span>
            <span className="num" title="Machines running">{formatNumber(m.exact)}</span>
          </li>
        ))}
      </ul>
      <h3>Power</h3>
      <dl className="power" data-testid="overview-power">
        <dt>Used</dt><dd>{formatRate(o.power.used, 'eu')}</dd>
        <dt>Generated</dt><dd>{formatRate(o.power.made, 'eu')}</dd>
        <dt>Net</dt><dd className={o.power.net < -1e-6 ? 'neg' : ''}>{formatRate(o.power.net, 'eu')}</dd>
      </dl>
    </aside>
  );
}
