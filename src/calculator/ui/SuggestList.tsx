import { suggestFor } from '../../calc/suggest';
import type { ResourceKey } from '../../recipes/types';
import { newRecipeNode } from '../newNodes';
import { useGraph } from './graphContext';
import { RecipeLine } from './RecipeBrowser';

/** Recipes that could make `resource` for this chain; the user picks one. */
export function SuggestList({ resource, onDone }: { resource: ResourceKey; onDone(): void }) {
  const { chain, db, dispatch } = useGraph();
  const list = suggestFor(resource, chain, db);
  if (!list.length) {
    return <p className="suggest-list hint">Nothing in the recipe data makes this — mark it bought in or set a supply limit.</p>;
  }
  return (
    <ul className="suggest-list nowheel">
      {list.map((s) => (
        <li key={s.recipe.id} data-testid="suggestion">
          <RecipeLine recipe={s.recipe} db={db} />
          <div className="suggest-meta">
            {s.closesLoop && <span className="tag">closes loop</span>}
            <button
              onClick={() => {
                const node = newRecipeNode(s.recipe, chain, db, s.machine.mID);
                if (node) dispatch({ type: 'addNode', node });
                onDone();
              }}
            >
              Add
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
