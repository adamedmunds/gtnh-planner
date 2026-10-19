import { CATALOG } from '../../catalog';
import { formatRate } from '../../calculator/format';
import type { LineNetwork, PlacedBlock } from '../../model/types';

const SIDE_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'];

export function InfoPanel({ block, mask, network }: { block: PlacedBlock | undefined; mask: number | undefined; network?: LineNetwork }) {
  if (!block) return <aside className="panel info"><p className="hint">Hover a block to inspect it.</p><Help /></aside>;
  const e = CATALOG.get(block.key);
  return (
    <aside className="panel info">
      <h3>{e?.name ?? `Unknown: ${block.key}`}</h3>
      <dl>
        <dt>Position</dt><dd>{block.pos.join(', ')}</dd>
        {e && <><dt>mID</dt><dd>{e.mID}</dd></>}
        {block.facing !== undefined && <><dt>Front</dt><dd>{SIDE_NAMES[block.mainFacing ?? block.facing]}</dd></>}
        {block.mainFacing !== undefined && block.facing !== undefined && <><dt>Output</dt><dd>{SIDE_NAMES[block.facing]}</dd></>}
        {network && (
          <><dt>Carries</dt><dd>
            {network.name}
            {network.flow !== undefined ? ` · ${formatRate(network.flow, network.kind === 'power' ? 'eu' : network.kind)}` : ''}
            {` · ${e?.name ?? network.conduit}`}
          </dd></>
        )}
        {mask !== undefined && (
          <><dt>Connected</dt><dd>{SIDE_NAMES.filter((_, i) => mask & (1 << i)).join(', ') || 'none'}</dd></>
        )}
      </dl>
      <Help />
    </aside>
  );
}

function Help() {
  return (
    <ul className="help">
      <li><b>Left-click</b> place · <b>Right-click</b> remove</li>
      <li><b>R</b> rotate · <b>Shift+R</b> incl. up/down</li>
      <li><b>Shift+click</b> pipe face: toggle side</li>
      <li><b>Drag</b> orbit · <b>Right/middle-drag</b> pan · <b>Scroll</b> zoom</li>
    </ul>
  );
}
