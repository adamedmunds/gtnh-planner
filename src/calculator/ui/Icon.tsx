import { useEffect, useState } from 'react';
import { fallbackColour, iconStyle, loadIconIndex, type IconIndex } from '../../recipes/icons';
import type { ResourceKey } from '../../recipes/types';

const BASE = `${import.meta.env.BASE_URL}data/icons/`;
let cache: Promise<IconIndex | undefined> | undefined;

/** The icon index, loaded once; undefined until loaded or when there are no icons. */
export function useIcons(): IconIndex | undefined {
  const [index, setIndex] = useState<IconIndex>();
  useEffect(() => {
    let live = true;
    (cache ??= loadIconIndex(`${BASE}icons.json`)).then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, []);
  return index;
}

/** An item/fluid icon from the game, or a coloured square with the first letter when there is none. */
export function Icon({ k, name, px = 16 }: { k: ResourceKey; name?: string; px?: number }) {
  const style = iconStyle(useIcons(), k, px, BASE);
  if (style) return <span className="icon" title={name} style={{ width: px, height: px, ...style }} />;
  const letter = (name ?? k.replace(/^\w+:/, '')).trim().charAt(0).toUpperCase();
  return (
    <span className="icon fallback" title={name} style={{ width: px, height: px, background: fallbackColour(k), fontSize: px * 0.6 }}>
      {letter}
    </span>
  );
}
