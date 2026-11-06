import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRobloxConnect, RobloxApiError } from '../src/index.js';

// Fake Roblox API in memory, records every call.
function fakeFetch() {
  const calls = [];
  const store = { gp: [{ gamePassId: 1, name: 'Existing Pass', description: '', isForSale: true, iconAssetId: 0, priceInformation: { defaultPriceInRobux: 50 } }], dp: [] };
  let nextId = 100;
  let fail429 = 0;
  const fn = async (url, init) => {
    const u = new URL(url);
    const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : null;
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers });
    const isGp = u.pathname.includes('/game-passes');
    const list = isGp ? store.gp : store.dp;
    const idF = isGp ? 'gamePassId' : 'productId';
    const reply = (status, data) => new Response(data == null ? null : JSON.stringify(data), { status });
    if (fail429 > 0) { fail429--; return reply(429, { errorMessage: 'slow down' }); }
    if (init.method === 'GET' && u.pathname.endsWith('/creator')) {
      const m = u.pathname.match(/\/(\d+)\/creator$/);
      if (m && !u.pathname.endsWith('/game-passes/creator') && !u.pathname.endsWith('/developer-products/creator')) {
        const it = list.find((x) => String(x[idF]) === m[1]);
        return it ? reply(200, it) : reply(404, { errorMessage: 'not found' });
      }
      return reply(200, { [isGp ? 'gamePasses' : 'developerProducts']: list, nextPageToken: '' });
    }
    if (init.method === 'POST') {
      if (!isGp && list.some((x) => x.name === body.name)) return reply(400, { errorCode: 'DuplicateProductName', errorMessage: 'dup' });
      const it = { [idF]: nextId++, name: body.name, description: body.description ?? '', isForSale: body.isForSale === 'true', priceInformation: { defaultPriceInRobux: Number(body.price ?? 0) } };
      list.push(it);
      return reply(200, it);
    }
    if (init.method === 'PATCH') {
      const id = u.pathname.split('/').pop();
      const it = list.find((x) => String(x[idF]) === id);
      if (!it) return reply(404, { errorMessage: 'not found' });
      if (body.name) it.name = body.name;
      if (body.price) it.priceInformation.defaultPriceInRobux = Number(body.price);
      if (body.isForSale) it.isForSale = body.isForSale === 'true';
      return reply(204, null);
    }
    return reply(500, {});
  };
  return { fn, calls, store, set429: (n) => { fail429 = n; } };
}

const make = (f) => createRobloxConnect({ apiKey: 'test-key', universeId: 777, fetchImpl: f.fn, loadDotEnv: false });

test('list normalizes game passes and sends key header', async () => {
  const f = fakeFetch();
  const rc = make(f);
  const items = await rc.gamePasses.list();
  assert.equal(items.length, 1);
  assert.deepEqual({ id: items[0].id, price: items[0].price, isForSale: items[0].isForSale }, { id: 1, price: 50, isForSale: true });
  assert.equal(f.calls[0].path, '/game-passes/v1/universes/777/game-passes/creator');
  assert.equal(f.calls[0].headers['x-api-key'], 'test-key');
});

test('create sends multipart fields', async () => {
  const f = fakeFetch();
  const rc = make(f);
  const it = await rc.developerProducts.create({ name: '1 Aura Spin', price: 999, isForSale: true, description: 'x' });
  assert.equal(it.name, '1 Aura Spin');
  assert.equal(it.price, 999);
  assert.equal(it.isForSale, true);
  const c = f.calls.at(-1);
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/developer-products/v2/universes/777/developer-products');
  assert.equal(c.body.price, '999');
  assert.equal(c.body.isForSale, 'true');
});

test('update, setPrice, remove (= off sale)', async () => {
  const f = fakeFetch();
  const rc = make(f);
  let it = await rc.gamePasses.setPrice({ id: 1, price: 123 });
  assert.equal(it.price, 123);
  it = await rc.gamePasses.remove({ id: 1 });
  assert.equal(it.isForSale, false);
  await assert.rejects(() => rc.gamePasses.update({ id: 1 }), /nothing to update/);
});

test('bulkCreate skips existing names and supports dryRun', async () => {
  const f = fakeFetch();
  const rc = make(f);
  const dry = await rc.gamePasses.bulkCreate({ items: [{ name: 'Existing Pass' }, { name: 'New Pass', price: 999 }], dryRun: true });
  assert.equal(dry.skipped, 1);
  assert.equal(f.store.gp.length, 1);
  const real = await rc.gamePasses.bulkCreate({ items: [{ name: 'Existing Pass' }, { name: 'New Pass', price: 999, isForSale: true }] });
  assert.equal(real.created, 1);
  assert.equal(real.skipped, 1);
  const again = await rc.gamePasses.bulkCreate({ items: [{ name: 'New Pass' }] });
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 1);
});

test('retries 429 then succeeds; errors become RobloxApiError', async () => {
  const f = fakeFetch();
  const rc = make(f);
  rc.client.maxRetries = 2;
  f.set429(1);
  const items = await rc.gamePasses.list();
  assert.equal(items.length, 1);
  await assert.rejects(() => rc.gamePasses.get({ id: 999 }), (e) => e instanceof RobloxApiError && e.status === 404);
});

test('missing api key fails clearly', () => {
  const saved = process.env.ROBLOX_API_KEY;
  delete process.env.ROBLOX_API_KEY;
  try {
    assert.throws(() => createRobloxConnect({ universeId: 1, loadDotEnv: false }), /Missing API key/);
  } finally {
    if (saved !== undefined) process.env.ROBLOX_API_KEY = saved;
  }
});
