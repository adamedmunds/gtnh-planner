import { useMemo, useState } from 'react';
import type { RecipeDb } from '../../recipes/db';
import type { ResourceKey } from '../../recipes/types';
import { Icon } from './Icon';

function Search({ db, placeholder, onPick }: { db: RecipeDb; placeholder: string; onPick(key: ResourceKey): void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim() ? db.search(q, 12) : []), [db, q]);
  return (
    <div className="start-search">
      <input className="search big" placeholder={placeholder} aria-label={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="start-results">
        {results.map((r) => (
          <li key={r.key}>
            <button data-testid="start-result" data-key={r.key} onClick={() => onPick(r.key)}>
              <Icon k={r.key} name={r.name} px={24} /> {r.name} <span className="hint">{r.kind === 'fluid' ? 'fluid' : ''}</span>
            </button>
          </li>
        ))}
        {q.trim() && !results.length && <li className="hint">Nothing matches “{q}”.</li>}
      </ul>
    </div>
  );
}

/** The empty graph: start from what you want to make, or from what you have. */
export function StartPrompt({ db, onMake, onHave }: { db: RecipeDb; onMake(key: ResourceKey): void; onHave(key: ResourceKey): void }) {
  return (
    <div className="start">
      <h2>Plan a production line</h2>
      <div className="start-columns">
        <section>
          <h3>Start from what you want</h3>
          <Search db={db} placeholder="What do you want to make?" onPick={onMake} />
        </section>
        <section>
          <h3>Or from what you have</h3>
          <Search db={db} placeholder="What do you have?" onPick={onHave} />
        </section>
      </div>
    </div>
  );
}
