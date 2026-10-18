import { gzipSync, strToU8 } from 'fflate';
import { loadRecipeDb } from './load';
import { K, oilBerryData } from '../test/oilBerryDb';

const stub = (body: BodyInit | null, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
const gz = (data: unknown) => gzipSync(strToU8(JSON.stringify(data)));

test('gzipped data loads into a RecipeDb', async () => {
  const r = await loadRecipeDb('/x', stub(gz(oilBerryData())));
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') return;
  expect(r.db.resource(K.lightFuel)?.name).toBe('Light Fuel');
  expect(r.warning).toBeUndefined();
});

test('data the browser already decoded (no gzip magic) also loads', async () => {
  const r = await loadRecipeDb('/x', stub(JSON.stringify(oilBerryData())));
  expect(r.status).toBe('ok');
});

test('404 means missing', async () => {
  expect(await loadRecipeDb('/x', stub(null, 404))).toEqual({ status: 'missing' });
});

test('the dev server HTML fallback means missing', async () => {
  expect(await loadRecipeDb('/x', stub('<!doctype html><html></html>'))).toEqual({ status: 'missing' });
});

test('a different GregTech version loads with a warning', async () => {
  const r = await loadRecipeDb('/x', stub(gz({ ...oilBerryData(), gregtech: '5.09.55.0' })));
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') return;
  expect(r.warning).toMatch(/5\.09\.55\.0/);
  expect(r.warning).toMatch(/5\.09\.54\.183/);
});

test('corrupt gzip is an error, not missing', async () => {
  const r = await loadRecipeDb('/x', stub(new Uint8Array([0x1f, 0x8b, 1, 2, 3])));
  expect(r.status).toBe('error');
});

test('JSON that is not planner data is an error', async () => {
  const r = await loadRecipeDb('/x', stub(JSON.stringify({ hello: 1 })));
  expect(r.status).toBe('error');
});

test('a network failure is an error', async () => {
  const r = await loadRecipeDb('/x', (async () => { throw new Error('offline'); }) as typeof fetch);
  expect(r).toEqual({ status: 'error', message: 'offline' });
});
