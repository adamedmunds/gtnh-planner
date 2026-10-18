import { createTextureCache } from './textures';

test('missing texture paths resolve to null without calling the loader', async () => {
  const load = vi.fn();
  const cache = createTextureCache(load);
  expect(await cache.get(undefined)).toBeNull();
  expect(load).not.toHaveBeenCalled();
});

test('failed loads resolve to null (flat colour fallback), warn once, and are cached', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn().mockRejectedValue(new Error('404'));
  const cache = createTextureCache(load, '/textures/');
  expect(await cache.get('blocks/x.png')).toBeNull();
  expect(await cache.get('blocks/x.png')).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith('/textures/blocks/x.png');
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
