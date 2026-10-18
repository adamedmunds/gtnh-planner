/** Notes for building a generated line: what the slices handle, covers to add, warnings. */
export function LineNotes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <aside className="panel line-notes" data-testid="line-notes">
      <h3>Line notes</h3>
      <ul>
        {notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </aside>
  );
}
