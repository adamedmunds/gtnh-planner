import { fallbackColour, iconStyle, loadIconIndex, parseIconIndex } from './icons';

const raw = {
  format: 1,
  size: 32,
  perRow: 64,
  sheets: ['icons-0.png', 'icons-1.png'],
  icons: { 'item:a@0': [0, 0, 0], 'fluid:oil': [1, 3, 2], 'item:bad@0': [5, 0, 0] },
};

test('parses a valid index and drops out-of-range entries', () => {
  const index = parseIconIndex(raw)!;
  expect(index.sheets).toEqual(['icons-0.png', 'icons-1.png']);
  expect(Object.keys(index.icons).sort()).toEqual(['fluid:oil', 'item:a@0']);
});

test('rejects anything else', () => {
  expect(parseIconIndex(null)).toBeUndefined();
  expect(parseIconIndex({})).toBeUndefined();
  expect(parseIconIndex({ ...raw, format: 2 })).toBeUndefined();
});

test('iconStyle positions the sprite, scaled to the requested size', () => {
  expect(iconStyle(parseIconIndex(raw), 'fluid:oil', 16, '/data/icons/')).toEqual({
    backgroundImage: 'url(/data/icons/icons-1.png)',
    backgroundPosition: '-48px -32px',
    backgroundSize: '1024px 1024px',
  });
});

test('no icon (or no index) gives undefined', () => {
  expect(iconStyle(parseIconIndex(raw), 'item:nope@0', 16, '/')).toBeUndefined();
  expect(iconStyle(undefined, 'item:a@0', 16, '/')).toBeUndefined();
});

test('fallbackColour is stable per key and differs between keys', () => {
  expect(fallbackColour('fluid:oil')).toBe(fallbackColour('fluid:oil'));
  expect(fallbackColour('fluid:oil')).toMatch(/^hsl\(\d+ 45% 45%\)$/);
  expect(fallbackColour('fluid:oil')).not.toBe(fallbackColour('item:a@0'));
});

test('loadIconIndex: 404 or bad JSON gives undefined', async () => {
  const stub = (body: string | null, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
  expect(await loadIconIndex('/x', stub(null, 404))).toBeUndefined();
  expect(await loadIconIndex('/x', stub('<!doctype html>'))).toBeUndefined();
  expect(await loadIconIndex('/x', stub(JSON.stringify(raw)))).toBeDefined();
});
