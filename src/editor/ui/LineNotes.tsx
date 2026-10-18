import type { GeneratedLine } from '../../layout/types';

export interface LineNotesProps {
  notes?: string[];
  /** Present while the build is an untouched generated modular line. */
  generated?: GeneratedLine;
  onAddSlice(end: 'left' | 'right'): void;
  onRemoveSlice(end: 'left' | 'right'): void;
  onExportSlice(): void;
}

/** Notes for building a generated line, and — for a modular line — growing it by slices. */
export function LineNotes({ notes, generated, onAddSlice, onRemoveSlice, onExportSlice }: LineNotesProps) {
  const modular = generated?.style === 'modular';
  if (!notes?.length && !modular) return null;
  return (
    <aside className="panel line-notes" data-testid="line-notes">
      <h3>Line notes</h3>
      {notes?.length ? (
        <ul>
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      ) : null}
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
