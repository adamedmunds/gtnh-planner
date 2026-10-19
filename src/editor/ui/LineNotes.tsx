import { Icon } from '../../calculator/ui/Icon';
import { formatRate } from '../../calculator/format';
import type { GeneratedLine } from '../../layout/types';
import type { LineNetwork } from '../../model/types';

export interface LineNotesProps {
  notes?: string[];
  /** Present while the build is an untouched generated modular line. */
  generated?: GeneratedLine;
  onAddSlice(end: 'left' | 'right'): void;
  onRemoveSlice(end: 'left' | 'right'): void;
  onExportSlice(): void;
  networks?: LineNetwork[];
  /** Name of the network picked in the legend (highlighted in 3D), if any. */
  picked?: string;
  onPick(name: string | undefined): void;
}

/** Notes for building a generated line, and — for a modular line — growing it by slices. */
export function LineNotes({ notes, generated, onAddSlice, onRemoveSlice, onExportSlice, networks, picked, onPick }: LineNotesProps) {
  const modular = generated?.style === 'modular';
  if (!notes?.length && !modular && !networks?.length) return null;
  // One legend row per name (each slice's own LV network shares the name).
  const legend = [...new Map((networks ?? []).map((n) => [n.name, n])).values()];
  return (
    <aside className="panel line-notes" data-testid="line-notes">
      <h3>Line notes</h3>
      {notes?.length ? (
        <ul>
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      ) : null}
      {legend.length > 0 && (
        <>
          <h3>What the pipes carry</h3>
          <ul className="legend">
            {legend.map((n) => (
              <li key={n.name}>
                <button
                  data-testid="legend-row"
                  className={picked === n.name ? 'on' : ''}
                  onClick={() => onPick(picked === n.name ? undefined : n.name)}
                  title="Highlight it in 3D"
                >
                  {n.kind === 'power' ? <span className="volt">⚡{n.tier}</span> : <Icon k={n.icon ?? ''} name={n.name} px={16} />}
                  {n.name}
                  {n.flow !== undefined && <span className="hint">{formatRate(n.flow, n.kind === 'power' ? 'eu' : n.kind)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {modular && (
        <div className="slice-buttons">
          <button onClick={() => onAddSlice('left')}>+ slice on the left</button>
          <button onClick={() => onAddSlice('right')}>+ slice on the right</button>
          <button onClick={() => onRemoveSlice('left')} disabled={generated.left === 0}>− slice on the left</button>
          <button onClick={() => onRemoveSlice('right')} disabled={generated.right === 0}>− slice on the right</button>
          <button className="primary" onClick={onExportSlice} title="A schematic of one slice, to line up at either end in game">Export one slice</button>
        </div>
      )}
    </aside>
  );
}
