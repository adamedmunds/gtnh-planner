import type { Build } from '../model/types';
import { initialState, reducer, type Action, type EditorState } from './state';

/** Undo/redo over block edits (place, remove, rotate, toggle, load, new). Selection, layer and name typing are not recorded. */
export interface History { past: EditorState[]; present: EditorState; future: EditorState[] }
export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

const LIMIT = 100;

export const initialHistory = (build?: Build): History => ({ past: [], present: initialState(build), future: [] });

/** Restore a snapshot's blocks and name, keeping the user's current tool selection and layer. */
const restore = (snapshot: EditorState, current: EditorState): EditorState => ({
  ...current,
  blocks: snapshot.blocks,
  name: snapshot.name,
});

export function historyReducer(h: History, a: HistoryAction): History {
  if (a.type === 'undo') {
    const prev = h.past.at(-1);
    if (!prev) return h;
    return { past: h.past.slice(0, -1), present: restore(prev, h.present), future: [h.present, ...h.future] };
  }
  if (a.type === 'redo') {
    const next = h.future[0];
    if (!next) return h;
    return { past: [...h.past, h.present].slice(-LIMIT), present: restore(next, h.present), future: h.future.slice(1) };
  }
  const next = reducer(h.present, a);
  if (next === h.present) return h;
  if (next.blocks === h.present.blocks) return { ...h, present: next };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}
