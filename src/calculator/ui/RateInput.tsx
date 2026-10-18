import { useEffect, useState } from 'react';
import { parseRateInput } from '../format';

/** A number field that commits on Enter or blur; anything that isn't a valid rate reverts. */
export function RateInput(p: { value: number; allowZero?: boolean; label: string; onCommit(n: number): void }) {
  const [text, setText] = useState(String(p.value));
  useEffect(() => setText(String(p.value)), [p.value]);
  const commit = () => {
    const n = parseRateInput(text, { allowZero: p.allowZero });
    if (n === undefined) setText(String(p.value));
    else if (n !== p.value) p.onCommit(n);
  };
  return (
    <input
      className="rate"
      aria-label={p.label}
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(String(p.value));
      }}
    />
  );
}
