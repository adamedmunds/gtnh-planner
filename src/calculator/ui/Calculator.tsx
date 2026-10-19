import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutFailure, explainFailures, type FailureReason } from '../../layout/why';
import type { ResourceKey } from '../../recipes/types';
import { driveText, screenProblems } from '../drive';
import { summary } from '../overview';
import { useSolve } from '../useSolve';
import { ChainGraph } from './ChainGraph';
import { SummaryPanel } from './SummaryPanel';
import { chainReducer, type ChainAction } from '../chainState';
import { autoArrange } from '../layout';
import { newGeneratorNode, newRecipeNode } from '../newNodes';
import type { PickerMode, PickerRow } from '../picker';
import { Picker } from './Picker';
import { StartPrompt } from './StartPrompt';
import type { RecipeDb } from '../../recipes/db';
import type { ChainHistory, ChainHistoryAction } from '../chainState';
import { useRecipes } from '../useRecipes';
import type { Build } from '../../model/types';
import { buildLine } from '../../layout/build';
import { planLine } from '../../layout/plan';
import { resourceInfo } from '../graphModel';

const STRAIGHT_KEY = 'gtnh-planner:straight';

export interface CalculatorProps {
  active: boolean;
  /** Puts a laid-out line into the 3D Editor. */
  onBuild3d(build: Build): void;
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

function Workspace({ active, db, warning, history, dispatch, toast, onBuild3d }: CalculatorProps & { db: RecipeDb; warning?: string }) {
  const chain = history.present;
  // `want` / `have`: what the start screen was opened for, added together with the first machine.
  const [picker, setPicker] = useState<{ mode: PickerMode; want?: ResourceKey; have?: ResourceKey } | null>(null);
  const { current, shown, greyed, solving } = useSolve(chain, db);
  const s = useMemo(() => {
    const out = summary(chain, db, shown);
    // Numbers may come from the last good solve; problems always describe the latest one.
    return { ...out, problems: current ? screenProblems(current, chain, db) : [] };
  }, [chain, db, shown, current]);

  // Adding or removing boxes re-tidies the graph, as one undo step.
  const structural = useCallback(
    (actions: ChainAction[]) => {
      let next = actions.reduce(chainReducer, chain);
      next = chainReducer(next, { type: 'arrange', positions: autoArrange(next, db) });
      if (next !== chain) dispatch({ type: 'load', chain: next });
    },
    [chain, db, dispatch],
  );
  const openPicker = useCallback((mode: PickerMode) => setPicker({ mode }), []);

  // Build in 3D: plan the line as shown, lay it out, hand it to the 3D Editor.
  const [straight, setStraightState] = useState(() => {
    try {
      return localStorage.getItem(STRAIGHT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setStraight = (on: boolean) => {
    setStraightState(on);
    try {
      localStorage.setItem(STRAIGHT_KEY, on ? '1' : '0');
    } catch {
      // remembering the choice is only a convenience
    }
  };
  const canBuild = !!shown?.result.nodes.some((n) => !n.invalid && n.build > 0);
  // Why the last Build in 3D failed (stays until closed or the next try).
  const [failure, setFailure] = useState<FailureReason[]>();
  const build3d = () => {
    if (!shown) return;
    setFailure(undefined);
    const p = planLine(chain, db, shown, straight ? 'straight' : 'modular');
    if ('error' in p) return setFailure(explainFailures([p.error], []));
    try {
      const product = shown.product ? resourceInfo(shown.product.key, db).name : 'Production';
      const { build } = buildLine(p, `${product} line`);
      onBuild3d(build);
    } catch (e) {
      if (e instanceof LayoutFailure) setFailure(e.reasons);
      else toast((e as Error).message, 'error');
    }
  };
  const closePicker = useCallback(() => setPicker(null), []);
  const use = (row: PickerRow) => {
    const node = row.fuel ? newGeneratorNode(row.fuel, chain, db) : newRecipeNode(row.recipe!, chain, db, row.machine.mID);
    if (!node) return toast('No machine can run this', 'error');
    structural([
      { type: 'addNode', node },
      ...(picker?.want ? [{ type: 'setWant', key: picker.want } as ChainAction] : []),
      ...(picker?.have ? [{ type: 'setHave', key: picker.have } as ChainAction] : []),
    ]);
    setPicker(null);
  };

  return (
    <>
      {warning && <div className="banner" data-testid="version-warning">{warning}</div>}
      <div className="calc">
        <SummaryPanel
          s={s}
          greyed={greyed}
          solving={solving}
          canAddPower={!chain.nodes.some((n) => n.kind === 'generator')}
          onPower={() => openPicker({ kind: 'power' })}
        />
        <section className="calc-centre">
          <div className="drive-line" data-testid="drive-line">{current ? driveText(current, chain, db) : 'Working it out…'}</div>
          <div className="graph">
            {chain.nodes.length === 0 && (
              <StartPrompt
                db={db}
                onMake={(key) => setPicker({ mode: { kind: 'makes', key }, want: key })}
                onHave={(key) => setPicker({ mode: { kind: 'uses', key }, have: key })}
              />
            )}
            <ChainGraph
              onBuild3d={canBuild ? build3d : undefined}
              straight={straight}
              onStraight={setStraight}
              openPicker={openPicker}
              structural={structural}
              active={active}
              chain={chain}
              db={db}
              screen={shown}
              greyed={greyed}
              canUndo={history.past.length > 0}
              canRedo={history.future.length > 0}
              dispatch={dispatch}
            />
          </div>
          {failure && <BuildFailure reasons={failure} straight={straight} onClose={() => setFailure(undefined)} />}
        </section>
      </div>
      {picker && <Picker mode={picker.mode} chain={chain} db={db} onClose={closePicker} onUse={use} />}
    </>
  );
}

/** Why Build in 3D couldn't lay the line out, and what to try. */
function BuildFailure({ reasons, straight, onClose }: { reasons: FailureReason[]; straight: boolean; onClose(): void }) {
  const tries = [...new Set(reasons.flatMap((r) => r.tips))].filter((t) => !(straight && /^Try ticking "Straight line"/.test(t)));
  return (
    <aside className="panel build-failure" data-testid="build-failure" role="alert">
      <button className="close" onClick={onClose} title="Close" aria-label="Close">×</button>
      <h3>Couldn't lay this line out in 3D</h3>
      <p className="hint">What got in the way (of the layouts tried):</p>
      <ul>
        {reasons.map((r) => (
          <li key={r.text}>{r.text}{r.count > 1 ? <span className="hint"> · {r.count} times</span> : null}</li>
        ))}
      </ul>
      {tries.length > 0 && (
        <>
          <p className="hint">Things to try:</p>
          <ul>{tries.map((a) => <li key={a}>{a}</li>)}</ul>
        </>
      )}
    </aside>
  );
}
