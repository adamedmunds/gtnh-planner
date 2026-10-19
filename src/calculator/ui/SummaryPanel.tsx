import { formatNumber, formatRate } from '../format';
import type { RateRow, Summary } from '../overview';
import { Icon } from './Icon';
import { TierBadge } from './TierBadge';

function Rows({ rows, testId, empty }: { rows: RateRow[]; testId: string; empty: string }) {
  return (
    <ul className="rows" data-testid={testId}>
      {rows.length === 0 && <li className="hint">{empty}</li>}
      {rows.map((r) => (
        <li key={r.key}>
          <span className="name"><Icon k={r.key} name={r.name} px={18} /> {r.name}</span>
          <span className="num">{formatRate(r.rate, r.kind)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The left panel: what goes in, what comes out, what to build, power, problems. */
export function SummaryPanel({ s, greyed, solving, canAddPower, onPower }: { s: Summary; greyed: boolean; solving: boolean; canAddPower: boolean; onPower(): void }) {
  return (
    <aside className={`panel overview${greyed ? ' greyed' : ''}`} aria-busy={solving}>
      {s.problems.length > 0 && (
        <>
          <h3>Problems</h3>
          <ul className="problems" data-testid="summary-problems">
            {s.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </>
      )}
      <h3>What I have</h3>
      <Rows rows={s.haves} testId="summary-have" empty="Nothing yet" />
      <h3>What I get</h3>
      <Rows rows={s.gets} testId="summary-get" empty="Nothing yet" />
      {s.alsoMade.length > 0 && (
        <>
          <h3>Also made</h3>
          <Rows rows={s.alsoMade} testId="summary-also" empty="" />
        </>
      )}
      <h3>Machines to build</h3>
      <ul className="rows" data-testid="summary-machines">
        {s.machines.length === 0 && <li className="hint">None yet</li>}
        {s.machines.map((m) => (
          <li key={m.name}>
            <span className="name"><Icon k={m.icon} name={m.name} px={18} /> ×{m.build} {m.name} <TierBadge tier={m.tier} /></span>
            <span className="num" title="Machines running">{formatNumber(m.exact)}</span>
          </li>
        ))}
      </ul>
      <h3>Power</h3>
      <dl className="power" data-testid="summary-power">
        <dt>Used</dt><dd>{formatRate(s.power.used, 'eu')}</dd>
        <dt>Generated</dt><dd>{formatRate(s.power.made, 'eu')}</dd>
        <dt>From outside</dt>
        <dd>
          {formatRate(s.power.outside, 'eu')}
          {s.power.outsideByTier.length > 0 && (
            <span className="hint" title="Nothing in the line makes power at this voltage"> ({s.power.outsideByTier.map((t) => t.tier).join(', ')})</span>
          )}
        </dd>
      </dl>
      {canAddPower && s.power.outside > 0 && <button className="power-btn" onClick={onPower}>Power it with a generator</button>}
    </aside>
  );
}
