import type { Chain } from '../../calc/chain';
import type { RecipeDb } from '../../recipes/db';
import type { ChainAction } from '../chainState';
import { resourceInfo } from '../graphModel';
import { RateInput } from './RateInput';
import { useResourceMenu } from './ResourceMenu';

export function TargetsBar({ chain, db, dispatch }: { chain: Chain; db: RecipeDb; dispatch: (a: ChainAction) => void }) {
  const openMenu = useResourceMenu();
  const name = (key: string) => resourceInfo(key, db).name;
  const empty = !chain.targets.length && !chain.limits.length && !chain.externals.length;
  return (
    <div className="targets" data-testid="targets-bar">
      {empty && <span className="hint">Set a target with the buttons under an item in the recipe browser, or with ⋯ (or right-click) on any item or fluid.</span>}
      {chain.targets.map((t) => (
        <span key={`t:${t.key}`} className="chip target" onContextMenu={(e) => openMenu(e, t.key)}>
          <b>Make</b> {name(t.key)}{' '}
          {'rate' in t ? (
            <>
              <RateInput value={t.rate} label={`Target rate for ${name(t.key)}`} onCommit={(rate) => dispatch({ type: 'setTarget', target: { key: t.key, rate } })} />
              /s
              <button title="Make as much as the limits allow" onClick={() => dispatch({ type: 'setTarget', target: { key: t.key, maximise: true } })}>max</button>
            </>
          ) : (
            <button title="Make a fixed rate instead" onClick={() => dispatch({ type: 'setTarget', target: { key: t.key, rate: 1 } })}>as much as possible</button>
          )}
          <button className="x" title="Remove target" onClick={() => dispatch({ type: 'removeTarget', key: t.key })}>×</button>
        </span>
      ))}
      {chain.limits.map((l) => (
        <span key={`l:${l.key}`} className="chip limit" onContextMenu={(e) => openMenu(e, l.key)}>
          {name(l.key)} ≤{' '}
          <RateInput value={l.maxRate} allowZero label={`Supply limit for ${name(l.key)}`} onCommit={(maxRate) => dispatch({ type: 'setLimit', key: l.key, maxRate })} />
          /s
          <button className="x" title="Remove supply limit" onClick={() => dispatch({ type: 'removeLimit', key: l.key })}>×</button>
        </span>
      ))}
      {chain.externals.map((k) => (
        <span key={`e:${k}`} className="chip external" onContextMenu={(e) => openMenu(e, k)}>
          {name(k)} bought in
          <button className="x" title="Stop treating as bought in" onClick={() => dispatch({ type: 'setExternal', key: k, on: false })}>×</button>
        </span>
      ))}
    </div>
  );
}
