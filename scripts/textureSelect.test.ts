import { selectTextures, wantedTexturePaths } from './textureSelect';
import { CATALOG_ENTRIES } from '../src/catalog';

const bytes = (s: string) => new TextEncoder().encode(s);

test('wanted paths are the unique texture paths referenced by the catalog', () => {
  const wanted = wantedTexturePaths(CATALOG_ENTRIES);
  expect(wanted).toContain('blocks/iconsets/MACHINE_LV_SIDE.png');
  expect(wanted).toContain('blocks/basicmachines/distillery/OVERLAY_FRONT.png');
  expect(new Set(wanted).size).toBe(wanted.length);
});

test('selectTextures maps jar entries to public paths, keeps .mcmeta, reports missing', () => {
  const jar = {
    'assets/gregtech/textures/blocks/a.png': bytes('A'),
    'assets/gregtech/textures/blocks/a.png.mcmeta': bytes('{}'),
    'assets/gregtech/textures/blocks/unused.png': bytes('U'),
  };
  const { files, missing } = selectTextures(jar, ['blocks/a.png', 'blocks/b.png']);
  expect(Object.keys(files).sort()).toEqual(['blocks/a.png', 'blocks/a.png.mcmeta']);
  expect(missing).toEqual(['blocks/b.png']);
});
