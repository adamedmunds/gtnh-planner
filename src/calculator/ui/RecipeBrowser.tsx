import { useMemo, useState } from 'react';
import type { Chain } from '../../calc/chain';
import { defaultMachine, generatorOptions } from '../../calc/machines';
import type { RecipeDb } from '../../recipes/db';
import type { Recipe, ResourceKey, Stack } from '../../recipes/types';
import type { ChainAction } from '../chainState';
import { formatNumber } from '../format';
import { resourceInfo } from '../graphModel';
import { newGeneratorNode, newRecipeNode } from '../newNodes';
import { useResourceActions, useResourceMenu } from './ResourceMenu';

const PAGE = 50;
type Tab = 'made' | 'used' | 'burned';

/** "3× Hydrogen Cell", "12,000 L Light Fuel", "Sulfur Dust (25%)". */
export function StackText({ s, db }: { s: Stack; db: RecipeDb }) {
  const openMenu = useResourceMenu();
  const { name, kind } = resourceInfo(s.key, db);
  const amount = kind === 'fluid' ? `${formatNumber(s.amount)} L ` : s.amount > 1 ? `${formatNumber(s.amount)}× ` : '';
  return (
    <span className={`stack${s.consumed === false ? ' kept' : ''}`} onContextMenu={(e) => openMenu(e, s.key)} title={s.consumed === false ? 'Not consumed' : undefined}>
      {amount}{name}
      {s.chance !== undefined && s.chance < 1 ? ` (${formatNumber(s.chance * 100)}%)` : ''}
    </span>
  );
}

export function RecipeLine({ recipe, db }: { recipe: Recipe; db: RecipeDb }) {
  const join = (list: Stack[]) => list.map((s, i) => <span key={`${s.key}${i}`}>{i > 0 && ', '}<StackText s={s} db={db} /></span>);
  return (
    <div className="recipe-line">
      <div>{join(recipe.inputs)} → {join(recipe.outputs)}</div>
      <div className="hint">
        {db.map(recipe.map).name} · {formatNumber(recipe.eut)} EU/t · {formatNumber(recipe.duration / 20)} s · {defaultMachine(recipe, db)?.name ?? 'no machine'}
      </div>
    </div>
  );
}

export interface RecipeBrowserProps {
  db: RecipeDb;
  chain: Chain;
  dispatch: (a: ChainAction) => void;
  selected?: ResourceKey;
  onSelect(key: ResourceKey | undefined): void;
  toast(text: string, kind?: 'info' | 'error'): void;
}

export function RecipeBrowser({ db, chain, dispatch, selected, onSelect, toast }: RecipeBrowserProps) {
  const openMenu = useResourceMenu();
  const actionsFor = useResourceActions();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('made');
  const [shown, setShown] = useState(PAGE);
  const results = useMemo(() => (query.trim() ? db.search(query, PAGE) : []), [db, query]);

  const made = selected ? db.producersOf(selected) : [];
  const used = selected ? db.consumersOf(selected) : [];
  const burned = selected ? db.fuelUsesOf(selected) : [];
  const current = tab === 'burned' && !burned.length ? 'made' : tab;
  const list = current === 'made' ? made : used;

  const pick = (key: ResourceKey) => {
    onSelect(key);
    setQuery('');
    setShown(PAGE);
  };
  const add = (node: ReturnType<typeof newRecipeNode>, what: string) => {
    if (!node) return toast(`No machine can run this ${what}`, 'error');
    dispatch({ type: 'addNode', node });
    toast(`Added ${what}`);
  };

  return (
    <aside className="panel browser">
      <input
        className="search"
        placeholder="Search items and fluids"
        aria-label="Search items and fluids"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.key}>
              <button data-testid="browser-result" data-key={r.key} onClick={() => pick(r.key)} onContextMenu={(e) => openMenu(e, r.key)}>
                {r.name} <span className="hint">{r.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && <p className="hint">Nothing matches “{query}”.</p>}
      {selected && !query.trim() && (
        <>
          <h2 data-testid="browser-selected" onContextMenu={(e) => openMenu(e, selected)} title="Right-click for targets and limits">
            {resourceInfo(selected, db).name}
          </h2>
          <div className="browser-actions" data-testid="browser-actions">
            {actionsFor(selected).map((a) => <button key={a.label} onClick={a.run}>{a.label}</button>)}
          </div>
          <div className="tabs">
            <button className={current === 'made' ? 'on' : ''} onClick={() => { setTab('made'); setShown(PAGE); }}>Made by ({made.length})</button>
            <button className={current === 'used' ? 'on' : ''} onClick={() => { setTab('used'); setShown(PAGE); }}>Used in ({used.length})</button>
            {burned.length > 0 && <button className={current === 'burned' ? 'on' : ''} onClick={() => setTab('burned')}>Burned in ({burned.length})</button>}
          </div>
          <ul className="recipes">
            {current === 'burned'
              ? burned.map((f) => {
                  const gen = generatorOptions(f.map, db)[0];
                  return (
                    <li key={f.map} data-testid="browser-row">
                      <div className="recipe-line">
                        <div>{db.map(f.map).name}</div>
                        <div className="hint">{formatNumber(f.euPerLitre)} EU/L before efficiency · {gen?.name ?? 'no generator'}</div>
                      </div>
                      <button data-testid="add-recipe" disabled={!gen} onClick={() => add(newGeneratorNode(f, chain, db), 'generator')}>Add</button>
                    </li>
                  );
                })
              : list.slice(0, shown).map((r) => (
                  <li key={r.id} data-testid="browser-row">
                    <RecipeLine recipe={r} db={db} />
                    {defaultMachine(r, db) ? (
                      <button data-testid="add-recipe" onClick={() => add(newRecipeNode(r, chain, db), db.map(r.map).name)}>Add</button>
                    ) : (
                      <button disabled>no machine</button>
                    )}
                  </li>
                ))}
          </ul>
          {current !== 'burned' && list.length > shown && <button onClick={() => setShown((n) => n + PAGE)}>Show more ({list.length - shown} left)</button>}
        </>
      )}
      {!selected && !query.trim() && <p className="hint">Search for an item or fluid to see what makes it and what uses it.</p>}
    </aside>
  );
}
