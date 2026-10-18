import type { BomLine } from '../../model/editing';

export function MaterialsPanel({ lines }: { lines: BomLine[] }) {
  return (
    <aside className="panel materials">
      <h3>Materials</h3>
      {lines.length === 0 ? <p className="hint">Nothing placed yet.</p> : (
        <ul data-testid="materials">
          {lines.map((l) => <li key={l.key}>{l.count}× {l.name}</li>)}
        </ul>
      )}
    </aside>
  );
}
