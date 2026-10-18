import { useEffect, useState } from 'react';
import { loadRecipeDb, type RecipeLoad } from '../recipes/load';

export type RecipeState = RecipeLoad | { status: 'loading' } | { status: 'idle' };

let cache: Promise<RecipeLoad> | undefined;

/** Loads the recipe data the first time `enabled` is true; kept for the session once it has loaded. */
export function useRecipes(enabled: boolean): RecipeState {
  const [state, setState] = useState<RecipeState>({ status: enabled ? 'loading' : 'idle' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => (s.status === 'idle' ? { status: 'loading' } : s));
    const p = (cache ??= loadRecipeDb(`${import.meta.env.BASE_URL}data/recipes.json.gz`));
    p.then((r) => {
      if (r.status !== 'ok' && cache === p) cache = undefined; // let a reload retry
      if (live) setState(r);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}
