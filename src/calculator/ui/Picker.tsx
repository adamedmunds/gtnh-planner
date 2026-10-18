import { useEffect, useMemo, useState } from 'react';
import type { Chain } from '../../calc/chain';
import type { RecipeDb } from '../../recipes/db';
import type { Stack } from '../../recipes/types';
import { formatNumber } from '../format';
import { resourceInfo } from '../graphModel';
import { filterRows, pickerRows, pickerTitle, type PickerMode, type PickerRow } from '../picker';
import { Icon } from './Icon';

const PAGE = 10;

/** "50 L Oil", "2× Hydrogen Cell", "Sulfur Dust (25%)" with the item's icon. */
export function StackChip({ s, db }: { s: Stack; db: RecipeDb }) {
  const { name, kind } = resourceInfo(s.key, db);
  const amount = s.amount <= 0 ? '' : kind === 'fluid' ? `${formatNumber(s.amount)} L ` : s.amount > 1 ? `${formatNumber(s.amount)}× ` : '';
  const chance = s.chance !== undefined && s.chance < 1 ? ` (${formatNumber(s.chance * 100)}%)` : '';
  return (
    <span className="chip-item">
      <Icon k={s.key} name={name} px={20} />
      {amount}{name}{chance}
    </span>
  );
}

function Row({ row, best, db, onUse }: { row: PickerRow; best: boolean; db: RecipeDb; onUse(): void }) {
  const map = db.map(row.recipe?.map ?? row.fuel!.map).name;
  const join = (list: Stack[]) => list.map((s, i) => <StackChip key={`${s.key}${i}`} s={s} db={db} />);
  return (
    <li className={`picker-row${best ? ' best' : ''}`} data-testid="picker-row">
      <div className="picker-main">
        <div className="picker-flow">
          {join(row.consumed)}
          <span className="arrow">→</span>
          {row.fuel ? <span className="chip-item">EU</span> : join(row.outputs)}
          {row.reason && <span className="reason">{row.reason}</span>}
        </div>
        {row.kept.length > 0 && (
          <div className="picker-meta">needs {row.kept.map((s) => resourceInfo(s.key, db).name).join(', ')} (not used up)</div>
        )}
        <div className="picker-meta">
          {map} · {row.tier ? `${row.tier} ` : ''}{formatNumber(row.eut)} EU/t
          {row.fuel ? ` · ${formatNumber(row.fuel.euPerLitre)} EU per litre` : ` · ${formatNumber(row.seconds)} s`}
          {' · '}{row.machine.name}{row.machine.multiblock ? ' (multiblock)' : ''}
        </div>
      </div>
      <button className="use" data-testid="use-recipe" onClick={onUse}>Use this</button>
    </li>
  );
}

/** The big "what makes / what uses / power" chooser. */
export function Picker({ mode, chain, db, onClose, onUse }: { mode: PickerMode; chain: Chain; db: RecipeDb; onClose(): void; onUse(row: PickerRow): void }) {
  const [text, setText] = useState('');
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(() => pickerRows(mode, chain, db, 500), [mode, chain, db]);
  const rows = useMemo(() => filterRows(all, text, db), [all, text, db]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const what = mode.kind === 'power' ? 'generators' : 'recipes';
  return (
    <div className="picker-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker" data-testid="picker" role="dialog" aria-label={pickerTitle(mode, db)}>
        <header>
          {mode.kind !== 'power' && <Icon k={mode.key} name={resourceInfo(mode.key, db).name} px={32} />}
          <div>
            <h2>{pickerTitle(mode, db)}</h2>
            <div className="hint">{all.length} {what} · best match first</div>
          </div>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <input className="search" placeholder="Filter by name" aria-label="Filter" value={text} autoFocus onChange={(e) => { setText(e.target.value); setShown(PAGE); }} />
        <ul className="picker-rows">
          {rows.slice(0, shown).map((r, i) => <Row key={r.id} row={r} best={i === 0 && !text} db={db} onUse={() => onUse(r)} />)}
        </ul>
        {rows.length === 0 && <p className="hint">{all.length ? 'Nothing matches that filter.' : 'Nothing in your recipe data does this.'}</p>}
        {rows.length > shown && <button onClick={() => setShown((n) => n + PAGE)}>Show more ({rows.length - shown} left)</button>}
      </div>
    </div>
  );
}
