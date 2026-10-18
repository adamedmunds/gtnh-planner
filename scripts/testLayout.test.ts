import { TEST_LAYOUT } from './testLayout';
import { buildSchematic } from '../src/export/schematic';
import { CATALOG, CATALOG_ENTRIES } from '../src/catalog';

test('test layout only uses catalog keys and exports without warnings', () => {
  for (const b of TEST_LAYOUT.blocks) expect(CATALOG.has(b.key)).toBe(true);
  const { warnings, size } = buildSchematic(TEST_LAYOUT);
  expect(warnings).toEqual([]);
  expect(size).toEqual({ width: 15, height: 2, length: 6 });
});

test('test layout includes every processing machine at least once', () => {
  const used = new Set(TEST_LAYOUT.blocks.map((b) => b.key));
  const missing = CATALOG_ENTRIES.filter((e) => e.group === 'Machines' && !used.has(e.key)).map((e) => e.key);
  expect(missing).toEqual([]);
});
