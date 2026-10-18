import { TEST_LAYOUT } from './testLayout';
import { buildSchematic } from '../src/export/schematic';
import { CATALOG } from '../src/catalog';

test('test layout only uses catalog keys and exports without warnings', () => {
  for (const b of TEST_LAYOUT.blocks) expect(CATALOG.has(b.key)).toBe(true);
  const { warnings, size } = buildSchematic(TEST_LAYOUT);
  expect(warnings).toEqual([]);
  expect(size).toEqual({ width: 15, height: 2, length: 4 });
});
