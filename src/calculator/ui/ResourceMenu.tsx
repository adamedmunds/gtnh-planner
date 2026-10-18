import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Chain } from '../../calc/chain';
import type { ChainResult } from '../../calc/solve';
import type { RecipeDb } from '../../recipes/db';
import type { ResourceKey } from '../../recipes/types';
import type { ChainAction } from '../chainState';
import { formatRate } from '../format';
import { resourceInfo } from '../graphModel';

type Open = (e: React.MouseEvent, key: ResourceKey) => void;
export interface ResourceAction { label: string; run(): void }
const MenuContext = createContext<{ open: Open; actionsFor(key: ResourceKey): ResourceAction[] }>({ open: () => {}, actionsFor: () => [] });

/** Opens the resource menu: on right-click at the pointer, or from a button just below it. */
export const useResourceMenu = () => useContext(MenuContext).open;
/** The menu's actions for a resource, for showing them as buttons. */
export const useResourceActions = () => useContext(MenuContext).actionsFor;

const nice = (n: number | undefined) => (n !== undefined && n > 0 ? Number(n.toPrecision(4)) : 1);

export interface ResourceMenuProps {
  chain: Chain;
  db: RecipeDb;
  result?: ChainResult;
  dispatch: (a: ChainAction) => void;
  onShow(key: ResourceKey): void;
  children: ReactNode;
}

export function ResourceMenuProvider({ chain, db, result, dispatch, onShow, children }: ResourceMenuProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; key: ResourceKey } | null>(null);
  const open: Open = (e, key) => {
    e.preventDefault();
    if (e.type === 'click') {
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ x: r.left, y: r.bottom, key });
    } else setMenu({ x: e.clientX, y: e.clientY, key });
  };

  const actionsFor = (key: ResourceKey): ResourceAction[] => {
    const { kind } = resourceInfo(key, db);
    const made = nice(result?.outputs.get(key) ?? result?.byproducts.get(key));
    const used = nice(result?.inputs.get(key));
    const external = chain.externals.includes(key);
    return [
      { label: `Make ${formatRate(made, kind)}`, run: () => dispatch({ type: 'setTarget', target: { key, rate: made } }) },
      { label: 'Maximise', run: () => dispatch({ type: 'setTarget', target: { key, maximise: true } }) },
      { label: `Supply limit ${formatRate(used, kind)}`, run: () => dispatch({ type: 'setLimit', key, maxRate: used }) },
      { label: external ? 'Unmark bought in' : 'Mark bought in', run: () => dispatch({ type: 'setExternal', key, on: !external }) },
    ];
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const items: ResourceAction[] = menu
    ? [...actionsFor(menu.key), { label: 'Show in recipe browser', run: () => onShow(menu.key) }]
    : [];

  return (
    <MenuContext.Provider value={{ open, actionsFor }}>
      {children}
      {menu && (
        <div className="menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="menu-title">{resourceInfo(menu.key, db).name}</div>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                it.run();
                setMenu(null);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </MenuContext.Provider>
  );
}
