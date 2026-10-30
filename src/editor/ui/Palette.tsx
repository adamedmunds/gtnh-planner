import { useState } from 'react';
import { CATALOG_ENTRIES, type Tier } from '../../catalog';

const GROUPS = ['Machines', 'Power', 'Cables', 'Fluid pipes', 'Item pipes', 'Multiblock parts'];
const TIERS: Tier[] = ['LV', 'MV', 'HV'];

export function Palette({ selectedKey, onSelect }: { selectedKey: string; onSelect(key: string): void }) {
  const [tier, setTier] = useState<Tier>('LV');
  return (
    <aside className="panel palette">
      {GROUPS.map((group) => {
        let entries = CATALOG_ENTRIES.filter((e) => e.group === group);
        if (group === 'Machines') entries = entries.filter((e) => e.tier === tier);
        return (
          <section key={group}>
            <h3>{group}</h3>
            {group === 'Machines' && (
              <div className="tabs">
                {TIERS.map((t) => (
                  <button key={t} className={t === tier ? 'on' : ''} onClick={() => setTier(t)}>{t}</button>
                ))}
              </div>
            )}
            {entries.map((e) => (
              <button
                key={e.key}
                data-testid={`palette-${e.key}`}
                className={`item ${e.key === selectedKey ? 'on' : ''}`}
                onClick={() => onSelect(e.key)}
              >
                <span className="swatch" style={{ background: e.color }} />
                {e.name}
              </button>
            ))}
          </section>
        );
      })}
    </aside>
  );
}
