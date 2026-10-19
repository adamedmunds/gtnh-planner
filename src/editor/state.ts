import { addSlice, removeSlice } from '../layout/grow';
import { CATALOG } from '../catalog';
import { placeBlock, removeBlock, rotateBlock, toBlockMap, toggleSide, type BlockMap } from '../model/editing';
import type { Build, Facing, Vec3 } from '../model/types';

export const DEFAULT_KEY = 'distillery_lv';

export interface EditorState {
  name: string;
  blocks: BlockMap;
  selectedKey: string;
  /** Highest visible Y level; null shows everything. */
  layer: number | null;
  /** Build-level data carried along with the blocks (recipe machines, notes). */
  extras: Pick<Build, 'machines' | 'notes' | 'covers' | 'generated' | 'networks'>;
}

export type Action =
  | { type: 'place'; pos: Vec3; facing?: Facing }
  | { type: 'remove'; pos: Vec3 }
  | { type: 'rotate'; pos: Vec3; includeVertical: boolean }
  | { type: 'toggleSide'; pos: Vec3; side: number }
  | { type: 'select'; key: string }
  | { type: 'setName'; name: string }
  | { type: 'setLayer'; layer: number | null }
  | { type: 'load'; build: Build }
  /** Generated modular lines: one slice more or less on an end. */
  | { type: 'addSlice'; end: 'left' | 'right' }
  | { type: 'removeSlice'; end: 'left' | 'right' }
  | { type: 'new' };

export function initialState(build?: Build): EditorState {
  return {
    name: build?.name ?? 'untitled',
    blocks: toBlockMap(build?.blocks ?? []),
    selectedKey: DEFAULT_KEY,
    layer: null,
    extras: extrasOf(build),
  };
}

function extrasOf(build?: Build): EditorState['extras'] {
  const out: EditorState['extras'] = {};
  for (const k of ['machines', 'notes', 'covers', 'generated', 'networks'] as const) if (build?.[k]) (out as Record<string, unknown>)[k] = build[k];
  return out;
}

/** A hand edit: the build is no longer the generated line, so growing by slices no longer applies. */
const withBlocks = (s: EditorState, blocks: BlockMap): EditorState => {
  if (blocks === s.blocks) return s;
  const { generated: _, ...extras } = s.extras;
  return { ...s, blocks, extras };
};

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'place': {
      const entry = CATALOG.get(s.selectedKey);
      if (!entry) return s;
      const block = entry.kind === 'machine'
        ? { pos: a.pos, key: entry.key, facing: a.facing ?? 3 }
        : { pos: a.pos, key: entry.key };
      return withBlocks(s, placeBlock(s.blocks, block));
    }
    case 'remove':
      return withBlocks(s, removeBlock(s.blocks, a.pos));
    case 'rotate':
      return withBlocks(s, rotateBlock(s.blocks, a.pos, a.includeVertical));
    case 'toggleSide':
      return withBlocks(s, toggleSide(s.blocks, a.pos, a.side));
    case 'select':
      return CATALOG.has(a.key) ? { ...s, selectedKey: a.key } : s;
    case 'setName':
      return { ...s, name: a.name };
    case 'setLayer':
      return { ...s, layer: a.layer };
    case 'load':
      return { ...initialState(a.build), selectedKey: s.selectedKey };
    case 'addSlice':
    case 'removeSlice': {
      const built = toBuild(s);
      const next = a.type === 'addSlice' ? addSlice(built, a.end) : removeSlice(built, a.end);
      return next === built ? s : { ...s, blocks: toBlockMap(next.blocks), extras: extrasOf(next) };
    }
    case 'new':
      return { ...initialState(), selectedKey: s.selectedKey };
  }
}

export function toBuild(s: EditorState): Build {
  return { version: 1, name: s.name.trim() || 'untitled', blocks: [...s.blocks.values()], ...s.extras };
}
