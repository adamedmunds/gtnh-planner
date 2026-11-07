import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildSchematic } from './export/schematic';
import { computeConnections } from './model/connections';
import { posKey } from './model/directions';
import { billOfMaterials } from './model/editing';
import { parseProject, serializeProject } from './project/project';
import type { Build, Facing, Vec3 } from './model/types';
import { countsForBerryRate, makeOilBerryLine } from './presets/oilBerryLine';
import { downloadBytes, downloadText, safeFileName } from './editor/download';
import { historyReducer, initialHistory } from './editor/history';
import { isHidden, placementAllowed, sameHover, unknownKeys } from './editor/interaction';
import { createAutosaver, loadFromStorage, safeStorage } from './editor/persistence';
import { toBuild } from './editor/state';
import { Scene, type Hover } from './editor/scene/Scene';
import { InfoPanel } from './editor/ui/InfoPanel';
import { LineNotes } from './editor/ui/LineNotes';
import { labelSpots, networkMembers } from './editor/labels';
import { alignHint, sliceBuild } from './layout/grow';
import { MaterialsPanel } from './editor/ui/MaterialsPanel';
import { Palette } from './editor/ui/Palette';
import { Toasts, type Toast } from './editor/ui/Toasts';
import { Toolbar } from './editor/ui/Toolbar';
import { chainHistoryReducer, initialChainHistory } from './calculator/chainState';
import { loadChain, saveChain } from './calculator/chainStorage';
import { normalizeChain } from './calculator/drive';
import { Calculator } from './calculator/ui/Calculator';

const restored = loadFromStorage(safeStorage());
const restoredChain = loadChain(safeStorage());

const REPO_URL = 'https://github.com/adamedmunds/gtnh-planner';
const DISCLAIMER =
  'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT. ' +
  'Not affiliated with or endorsed by GregTech or the GT New Horizons team. ' +
  'Minecraft and mod textures, icons and recipe data belong to their respective owners.';

type Tab = 'editor' | 'calculator';
const TAB_KEY = 'gtnh-planner:tab';
const LABELS_KEY = 'gtnh-planner:labels';
function readTab(): Tab {
  try {
    return safeStorage()?.getItem(TAB_KEY) === 'calculator' ? 'calculator' : 'editor';
  } catch {
    return 'editor';
  }
}

export function App() {
  const [history, dispatch] = useReducer(historyReducer, restored.build ?? undefined, initialHistory);
  const state = history.present;
  const [chainHistory, chainDispatch] = useReducer(chainHistoryReducer, normalizeChain(restoredChain.chain), initialChainHistory);
  const chain = chainHistory.present;
  const [tab, setTabState] = useState<Tab>(readTab);
  const [calcOpened, setCalcOpened] = useState(tab === 'calculator');
  const setTab = (t: Tab) => {
    setTabState(t);
    if (t === 'calculator') setCalcOpened(true);
    try {
      safeStorage()?.setItem(TAB_KEY, t);
    } catch {
      // remembering the tab is only a convenience
    }
  };
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
    if (restoreNoticeShown.current) return;
    restoreNoticeShown.current = true;
    if (restored.error) toast(restored.error, 'error');
    if (restoredChain.error) toast(restoredChain.error, 'error');
  }, [toast]);

  const autosave = useMemo(
    () => createAutosaver(safeStorage, (msg) => toast(msg, 'error'), { alreadyNotified: !!restored.unavailable }),
    [toast],
  );

  // The chain autosaves the same way, telling the user once when saving starts failing.
  const chainSaveFailed = useRef(!!restored.unavailable);
  const autosaveChain = useCallback(
    (c: typeof chain) => {
      if (saveChain(safeStorage(), c)) chainSaveFailed.current = false;
      else if (!chainSaveFailed.current) {
        chainSaveFailed.current = true;
        toast("Couldn't autosave your calculator chain (storage full or blocked). Use Save .json to keep it.", 'error');
      }
    },
    [toast],
  );

  // Debounced autosave, plus an immediate save when the tab is closed or hidden.
  const latest = useRef(state);
  latest.current = state;
  const latestChain = useRef(chain);
  latestChain.current = chain;
  useEffect(() => {
    const h = setTimeout(() => autosave(toBuild(state)), 400);
    return () => clearTimeout(h);
  }, [state.blocks, state.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = setTimeout(() => autosaveChain(chain), 400);
    return () => clearTimeout(h);
  }, [chain, autosaveChain]);
  useEffect(() => {
    const flush = () => {
      autosave(toBuild(latest.current));
      autosaveChain(latestChain.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [autosave, autosaveChain]);

  const bom = useMemo(() => billOfMaterials(state.blocks.values()), [state.blocks]);
  const maxY = useMemo(() => Math.max(0, ...[...state.blocks.values()].map((b) => b.pos[1])), [state.blocks]);
  const hovered = hover && !hover.ground ? state.blocks.get(posKey(hover.pos)) : undefined;

  // What's in the pipes: labels, the legend pick, and the network under the pointer.
  const [showLabels, setShowLabelsState] = useState(() => {
    try {
      return safeStorage()?.getItem(LABELS_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const setShowLabels = (on: boolean) => {
    setShowLabelsState(on);
    try {
      safeStorage()?.setItem(LABELS_KEY, on ? '1' : '0');
    } catch {
      // remembering the toggle is only a convenience
    }
  };
  const [picked, setPicked] = useState<string>();
  // Pipes and cables can be hidden to see the machines behind them; hidden pipes take their labels with them.
  const [showPipes, setShowPipes] = useState(true);
  const [showCables, setShowCables] = useState(true);
  const hide = useMemo(() => ({ pipes: !showPipes, cables: !showCables }), [showPipes, showCables]);
  const networks = state.extras.networks;
  const labels = useMemo(() => {
    if (!showLabels || !networks?.length) return undefined;
    const spots = labelSpots(toBuild(state)).filter((s) => {
      const b = state.blocks.get(posKey(s.pos));
      return !b || !isHidden(b.key, hide);
    });
    return { spots, networks };
  }, [showLabels, networks, state.blocks, hide]); // eslint-disable-line react-hooks/exhaustive-deps
  const hoveredNetwork = hovered?.net ? networks?.find((n) => n.id === hovered.net) : undefined;
  const activeName = picked ?? hoveredNetwork?.name;
  const highlight = useMemo(() => {
    if (!activeName || !networks) return undefined;
    const blocks = [...state.blocks.values()];
    const ids = networks.filter((n) => n.name === activeName).map((n) => n.id);
    const members = new Set(ids.flatMap((id) => [...networkMembers(blocks, id)]));
    return blocks.filter((b) => members.has(posKey(b.pos))).map((b) => b.pos);
  }, [activeName, networks, state.blocks]);
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
    if (tab !== 'editor') return;
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
  }, [hover, frame, tab]);

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

  const onExportSlice = () => {
    try {
      const slice = sliceBuild(toBuild(state));
      const { bytes } = buildSchematic(slice);
      downloadBytes(bytes, `${safeFileName(slice.name)}.schematic`);
      toast(`Exported ${safeFileName(slice.name)}.schematic. ${alignHint(toBuild(state))}`);
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
      const { project, warnings, fromVersion } = parseProject(text);
      // A build-only (version 1) file replaces the build and keeps the chain.
      const replacesChain = fromVersion === 2;
      const empty = state.blocks.size === 0 && (!replacesChain || chain.nodes.length === 0);
      if (!empty && !window.confirm('Replace the current project? (Ctrl+Z undoes this.)')) return;
      loadBuild(project.build, warnings);
      if (replacesChain) chainDispatch({ type: 'load', chain: normalizeChain(project.chain) });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="shell">
      <nav className="tabbar">
        <button data-testid="tab-calculator" className={tab === 'calculator' ? 'on' : ''} onClick={() => setTab('calculator')}>Calculator</button>
        <button data-testid="tab-editor" className={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>3D Editor</button>
        <a className="source-link" data-testid="source-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
        <p className="disclaimer" data-testid="disclaimer" title={DISCLAIMER}>
          Unofficial fan tool. Not affiliated with Mojang, Microsoft, GregTech or GT New Horizons.
        </p>
      </nav>
    <div className="app" hidden={tab !== 'editor'}>
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
        onSave={() => downloadText(serializeProject({ version: 2, build: toBuild(state), chain }), `${safeFileName(state.name)}.json`)}
        onLoadFile={onLoadFile}
        onExport={onExport}
        onFrame={frame}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onLayer={(layer) => dispatch({ type: 'setLayer', layer })}
        showLabels={showLabels}
        onShowLabels={setShowLabels}
        showPipes={showPipes}
        onShowPipes={setShowPipes}
        showCables={showCables}
        onShowCables={setShowCables}
      />
      <Palette selectedKey={state.selectedKey} onSelect={(key) => dispatch({ type: 'select', key })} />
      <main className="viewport" data-highlight={activeName ?? ''}>
        <Scene
          labels={labels}
          highlight={highlight}
          blocks={state.blocks}
          layer={state.layer}
          hide={hide}
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
        <InfoPanel block={hovered} mask={hoveredMask} network={hoveredNetwork} />
        <LineNotes
          networks={networks}
          picked={picked}
          onPick={setPicked}
          notes={state.extras.notes}
          generated={state.extras.generated}
          onAddSlice={(end) => dispatch({ type: 'addSlice', end })}
          onRemoveSlice={(end) => dispatch({ type: 'removeSlice', end })}
          onExportSlice={onExportSlice}
        />
        <MaterialsPanel lines={bom} />
      </div>
    </div>
      {calcOpened && (
        <Calculator
          active={tab === 'calculator'}
          history={chainHistory}
          dispatch={chainDispatch}
          toast={toast}
          onBuild3d={(build) => {
            if (state.blocks.size > 0 && !window.confirm('Replace your 3D build with this line? (Ctrl+Z undoes this.)')) return;
            loadBuild(build);
            setTab('editor');
          }}
        />
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
