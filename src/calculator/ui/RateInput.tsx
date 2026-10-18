import { useEffect, useState } from 'react';
import { parseRateInput } from '../format';

const show = (v?: number) => (v === undefined ? '' : String(v));

/**
 * A number field that commits on Enter or blur. Anything that isn't a valid positive number reverts; with
 * `allowBlank`, clearing the field commits `undefined`.
 */
export function RateInput(p: {
  value?: number;
  placeholder?: string;
  allowZero?: boolean;
  allowBlank?: boolean;
  label: string;
  onCommit(n: number | undefined): void;
}) {
  const [text, setText] = useState(show(p.value));
  useEffect(() => setText(show(p.value)), [p.value]);
  const commit = () => {
    if (!text.trim()) {
      if (p.allowBlank) {
        if (p.value !== undefined) p.onCommit(undefined);
      } else setText(show(p.value));
      return;
    }
    const n = parseRateInput(text, { allowZero: p.allowZero });
    if (n === undefined) setText(show(p.value));
    else if (n !== p.value) p.onCommit(n);
  };
  return (
    <input
      className="rate nodrag"
      aria-label={p.label}
      value={text}
      placeholder={p.placeholder}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(show(p.value));
      }}
    />
  );
}
