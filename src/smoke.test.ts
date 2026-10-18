import { gzipSync, gunzipSync } from 'fflate';

test('toolchain runs and fflate round-trips', () => {
  const input = new Uint8Array([1, 2, 3]);
  expect(Array.from(gunzipSync(gzipSync(input)))).toEqual([1, 2, 3]);
});
