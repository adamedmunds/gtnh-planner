import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildSchematic } from './export/schematic';
import { computeConnections } from './model/connections';
import { posKey } from './model/directions';
import { billOfMaterials } from './model/editing';
import { parseBuild, serializeBuild } from './model/buildJson';
import type { Build, Facing, Vec3 } from './model/types';
import { countsForBerryRate, makeOilBerryLine } from './presets/oilBerryLine';
import { downloadBytes, downloadText, safeFileName } from './editor/download';
import { historyReducer, initialHistory } from './editor/history';
import { placementAllowed, sameHover, unknownKeys } from './editor/interaction';
import { createAutosaver, loadFromStorage, safeStorage } from './editor/persistence';
import { toBuild } from './editor/state';
import { Scene, type Hover } from './editor/scene/Scene';
import { InfoPanel } from './editor/ui/InfoPanel';
import { MaterialsPanel } from './editor/ui/MaterialsPanel';
import { Palette } from './editor/ui/Palette';
import { Toasts, type Toast } from './editor/ui/Toasts';
import { Toolbar } from './editor/ui/Toolbar';

const restored = loadFromStorage(safeStorage());

export function App() {
  const [history, dispatch] = useReducer(historyReducer, restored.build ?? undefined, initialHistory);
  const state = history.present;
  const [hover, setHoverState] = useState<Hover | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [frameToken, setFrameToken] = useState(restored.build?.blocks.length ? 1 : 0);
  const frame = useCallback(() => setFrameToken((t) => t + 1), []);
  // Pointer moves inside the same face keep the same object, so the scene doesn't re-render on every move.
  const setHover = useCallback((h: Hover | null) => setHoverState((prev) => (sameHover(prev, h) ? prev : h)), []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // Restore notice once (StrictMode runs mount effects twice in development).
  const restoreNoticeShown = useRef(false);
  useEffect(() => {
    if (restored.error && !restoreNoticeShown.current) {
      restoreNoticeShown.current = true;
      toast(restored.error, 'error');
    }
  }, [toast]);

  const autosave = useMemo(
    () => createAutosaver(safeStorage, (msg) => toast(msg, 'error'), { alreadyNotified: !!restored.unavailable }),
    [toast],
  );

  // Debounced autosave, plus an immediate save when the tab is closed or hidden.
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const h = setTimeout(() => autosave(toBuild(state)), 400);
    return () => clearTimeout(h);
  }, [state.blocks, state.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const flush = () => autosave(toBuild(latest.current));
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [autosave]);

  const bom = useMemo(() => billOfMaterials(state.blocks.values()), [state.blocks]);
  const maxY = useMemo(() => Math.max(0, ...[...state.blocks.values()].map((b) => b.pos[1])), [state.blocks]);
  const hovered = hover && !hover.ground ? state.blocks.get(posKey(hover.pos)) : undefined;
  const hoveredMask = useMemo(
    () => (hovered ? computeConnections([...state.blocks.values()]).get(posKey(hovered.pos)) : undefined),
    [hovered, state.blocks],
  );

  // Keep the layer slider in range when the build gets shorter.
  useEffect(() => {
    if (state.layer !== null && state.layer > maxY) dispatch({ type: 'setLayer', layer: null });
  }, [state.layer, maxY]);

  // Keyboard: R / Shift+R rotate, F frame, Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        } else if (key === 'y') {
          e.preventDefault();
          dispatch({ type: 'redo' });
        }
        return;
      }
      if (key === 'r' && hover && !hover.ground) dispatch({ type: 'rotate', pos: hover.pos, includeVertical: e.shiftKey });
      if (key === 'f') frame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hover, frame]);

  const confirmReplace = () => state.blocks.size === 0 || window.confirm('Replace the current build? (Ctrl+Z undoes this.)');

  const loadBuild = (build: Build, warnings: string[] = []) => {
    dispatch({ type: 'load', build });
    frame();
    toast(`Loaded ${build.name}`);
    for (const w of warnings) toast(w, 'error');
    for (const u of unknownKeys(build.blocks)) {
      toast(`${u.count} block(s) of unknown type "${u.key}" are shown in magenta and won't be exported.`, 'error');
    }
  };

  const onPlace = (pos: Vec3, facing: Facing) => {
    const allowed = placementAllowed(pos, state.layer);
    if (!allowed.ok) return toast(allowed.reason, 'error');
    dispatch({ type: 'place', pos, facing });
  };

  const onExport = () => {
    try {
      const { bytes, warnings } = buildSchematic(toBuild(state));
      downloadBytes(bytes, `${safeFileName(state.name)}.schematic`);
      toast(`Exported ${safeFileName(state.name)}.schematic — copy it into .minecraft/schematics`);
      for (const w of warnings) toast(w, 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const onExample = () => {
    if (!confirmReplace()) return;
    const answer = window.prompt('Berries per second to size the line for?', '5.6');
    if (answer === null) return;
    const rate = Number(answer);
    try {
      if (!(rate > 0)) throw new Error('Enter a positive number of berries per second');
      loadBuild(makeOilBerryLine(countsForBerryRate(rate)));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const onLoadFile = (text: string) => {
    try {
      const { build, warnings } = parseBuild(text);
      if (!confirmReplace()) return;
      loadBuild(build, warnings);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="app">
      <Toolbar
        name={state.name}
        canExport={state.blocks.size > 0}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        maxY={maxY}
        layer={state.layer}
        onName={(name) => dispatch({ type: 'setName', name })}
        onNew={() => window.confirm('Clear the current build? (Ctrl+Z undoes this.)') && dispatch({ type: 'new' })}
        onExample={onExample}
        onSave={() => downloadText(serializeBuild(toBuild(state)), `${safeFileName(state.name)}.json`)}
        onLoadFile={onLoadFile}
        onExport={onExport}
        onFrame={frame}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onLayer={(layer) => dispatch({ type: 'setLayer', layer })}
      />
      <Palette selectedKey={state.selectedKey} onSelect={(key) => dispatch({ type: 'select', key })} />
      <main className="viewport">
        <Scene
          blocks={state.blocks}
          layer={state.layer}
          selectedKey={state.selectedKey}
          hover={hover}
          frameToken={frameToken}
          onHover={setHover}
          onPlace={onPlace}
          onRemove={(pos) => {
            dispatch({ type: 'remove', pos });
            setHover(null); // drop the outline/preview on the removed cell
          }}
          onToggleSide={(pos, side) => dispatch({ type: 'toggleSide', pos, side })}
        />
      </main>
      <div className="side">
        <InfoPanel block={hovered} mask={hoveredMask} />
        <MaterialsPanel lines={bom} />
      </div>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
