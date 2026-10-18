import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildSchematic } from './export/schematic';
import { computeConnections } from './model/connections';
import { posKey } from './model/directions';
import { billOfMaterials } from './model/editing';
import { parseBuild, serializeBuild } from './model/buildJson';
import { countsForBerryRate, makeOilBerryLine } from './presets/oilBerryLine';
import { downloadBytes, downloadText, safeFileName } from './editor/download';
import { createAutosaver, loadFromStorage, safeStorage } from './editor/persistence';
import { initialState, reducer, toBuild } from './editor/state';
import { Scene, type Hover } from './editor/scene/Scene';
import { InfoPanel } from './editor/ui/InfoPanel';
import { MaterialsPanel } from './editor/ui/MaterialsPanel';
import { Palette } from './editor/ui/Palette';
import { Toasts, type Toast } from './editor/ui/Toasts';
import { Toolbar } from './editor/ui/Toolbar';

const restored = loadFromStorage(safeStorage());

export function App() {
  const [state, dispatch] = useReducer(reducer, restored.build ?? undefined, initialState);
  const [hover, setHover] = useState<Hover | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [frameToken, setFrameToken] = useState(restored.build?.blocks.length ? 1 : 0);
  const frame = useCallback(() => setFrameToken((t) => t + 1), []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (restored.error) toast(restored.error, 'error');
  }, [toast]);

  const autosave = useMemo(
    () => createAutosaver(safeStorage, (msg) => toast(msg, 'error'), { alreadyNotified: !!restored.unavailable }),
    [toast],
  );

  // Debounced autosave.
  useEffect(() => {
    const h = setTimeout(() => autosave(toBuild(state)), 400);
    return () => clearTimeout(h);
  }, [state.blocks, state.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // R / Shift+R rotate the hovered machine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key.toLowerCase() === 'r' && hover && !hover.ground) {
        dispatch({ type: 'rotate', pos: hover.pos, includeVertical: e.shiftKey });
      }
      if (e.key.toLowerCase() === 'f') frame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hover, frame]);

  const bom = useMemo(() => billOfMaterials(state.blocks.values()), [state.blocks]);
  const maxY = useMemo(() => Math.max(0, ...[...state.blocks.values()].map((b) => b.pos[1])), [state.blocks]);
  const hovered = hover && !hover.ground ? state.blocks.get(posKey(hover.pos)) : undefined;
  const hoveredMask = useMemo(
    () => (hovered ? computeConnections([...state.blocks.values()]).get(posKey(hovered.pos)) : undefined),
    [hovered, state.blocks],
  );

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
    const answer = window.prompt('Berries per second to size the line for?', '5.6');
    if (answer === null) return;
    const rate = Number(answer);
    try {
      if (!(rate > 0)) throw new Error('Enter a positive number of berries per second');
      const build = makeOilBerryLine(countsForBerryRate(rate));
      dispatch({ type: 'load', build });
      frame();
      toast(`Loaded ${build.name}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const onLoadFile = (text: string) => {
    try {
      const { build, warnings } = parseBuild(text);
      dispatch({ type: 'load', build });
      frame();
      toast(`Loaded ${build.name}`);
      for (const w of warnings) toast(w, 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="app">
      <Toolbar
        name={state.name}
        canExport={state.blocks.size > 0}
        maxY={maxY}
        layer={state.layer}
        onName={(name) => dispatch({ type: 'setName', name })}
        onNew={() => window.confirm('Clear the current build?') && dispatch({ type: 'new' })}
        onExample={onExample}
        onSave={() => downloadText(serializeBuild(toBuild(state)), `${safeFileName(state.name)}.json`)}
        onLoadFile={onLoadFile}
        onExport={onExport}
        onFrame={frame}
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
          onPlace={(pos, facing) => dispatch({ type: 'place', pos, facing })}
          onRemove={(pos) => dispatch({ type: 'remove', pos })}
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
