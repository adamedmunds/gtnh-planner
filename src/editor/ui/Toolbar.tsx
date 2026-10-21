import { useRef } from 'react';

export interface ToolbarProps {
  name: string;
  canExport: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maxY: number;
  layer: number | null;
  onName(name: string): void;
  onNew(): void;
  onExample(): void;
  onSave(): void;
  onLoadFile(text: string): void;
  onExport(): void;
  onFrame(): void;
  onUndo(): void;
  onRedo(): void;
  onLayer(layer: number | null): void;
  /** Floating pipe labels on generated lines. */
  showLabels: boolean;
  onShowLabels(on: boolean): void;
  /** Pipes and cables drawn in the 3D view. */
  showPipes: boolean;
  onShowPipes(on: boolean): void;
  showCables: boolean;
  onShowCables(on: boolean): void;
}

export function Toolbar(p: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <header className="toolbar">
      <input className="name" value={p.name} onChange={(e) => p.onName(e.target.value)} aria-label="Build name" />
      <button onClick={p.onNew}>New</button>
      <button onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)">Undo</button>
      <button onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Y)">Redo</button>
      <button data-testid="example" onClick={p.onExample}>Oil berry example</button>
      <button onClick={p.onSave}>Save .json</button>
      <button onClick={() => fileRef.current?.click()}>Load .json</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) p.onLoadFile(await file.text());
          e.target.value = '';
        }}
      />
      <button onClick={p.onFrame} title="Fit the build in view (F)">Frame</button>
      <label className="labels-toggle" title="Icons over the pipes saying what flows through them">
        <input type="checkbox" checked={p.showLabels} onChange={(e) => p.onShowLabels(e.target.checked)} /> Show what's in pipes
      </label>
      <label className="labels-toggle" title="Hide fluid and item pipes to see the machines behind them">
        <input type="checkbox" checked={p.showPipes} onChange={(e) => p.onShowPipes(e.target.checked)} /> Show pipes
      </label>
      <label className="labels-toggle" title="Hide cables to see the machines behind them">
        <input type="checkbox" checked={p.showCables} onChange={(e) => p.onShowCables(e.target.checked)} /> Show cables
      </label>
      <button data-testid="export" className="primary" disabled={!p.canExport} onClick={p.onExport}>Export .schematic</button>
      <label className="layer">
        Layer
        <input
          type="range"
          min={0}
          max={p.maxY + 1}
          value={p.layer === null ? p.maxY + 1 : p.layer}
          onChange={(e) => {
            const v = Number(e.target.value);
            p.onLayer(v > p.maxY ? null : v);
          }}
        />
        <span>{p.layer === null ? 'all' : `≤ ${p.layer}`}</span>
      </label>
    </header>
  );
}
