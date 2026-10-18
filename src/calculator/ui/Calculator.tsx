import { useEffect } from 'react';
import type { RecipeDb } from '../../recipes/db';
import type { ChainHistory, ChainHistoryAction } from '../chainState';
import { useRecipes } from '../useRecipes';

export interface CalculatorProps {
  active: boolean;
  history: ChainHistory;
  dispatch: (a: ChainHistoryAction) => void;
  toast(text: string, kind?: 'info' | 'error'): void;
}

export function Calculator(p: CalculatorProps) {
  const load = useRecipes(true);
  const { active, dispatch } = p;

  // Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, while this tab is showing and focus isn't in a text field.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (key === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dispatch]);

  let body: React.ReactNode;
  if (load.status === 'idle' || load.status === 'loading') {
    body = <div className="calc-status" data-testid="recipe-status">Loading recipes…</div>;
  } else if (load.status === 'missing') {
    body = (
      <div className="calc-status" data-testid="recipe-status">
        <h2>No recipe data yet</h2>
        <ol>
          <li>Start the <b>export v2</b> GTNH instance and run <code>/gtnhplanner dump</code> in a world.</li>
          <li>In this project, run <code>npm run recipes</code>.</li>
          <li>Reload this page.</li>
        </ol>
        <p className="hint">The 3D Editor works without recipe data.</p>
      </div>
    );
  } else if (load.status === 'error') {
    body = (
      <div className="calc-status error" data-testid="recipe-status">
        <h2>Couldn't load the recipe data</h2>
        <p>{load.message}</p>
      </div>
    );
  } else {
    body = <Workspace db={load.db} warning={load.warning} {...p} />;
  }
  return (
    <div className="calc-root" hidden={!active}>
      {body}
    </div>
  );
}

function Workspace({ warning }: CalculatorProps & { db: RecipeDb; warning?: string }) {
  return (
    <>
      {warning && <div className="banner" data-testid="version-warning">{warning}</div>}
      <div className="calc">
        <aside className="panel overview" />
        <section className="calc-centre" />
        <aside className="panel browser">
          <input className="search" placeholder="Search items and fluids" aria-label="Search items and fluids" />
        </aside>
      </div>
    </>
  );
}
