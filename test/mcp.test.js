import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';

test('MCP server exposes tools for every resource and calls them', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ method: init.method, url: String(url) });
    if (init.method === 'POST') {
      return new Response(JSON.stringify({ gamePassId: 5, name: 'X', isForSale: true, priceInformation: { defaultPriceInRobux: 999 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ gamePasses: [], developerProducts: [], nextPageToken: '' }), { status: 200 });
  };
  const server = createMcpServer({ apiKey: 'k', universeId: 1, fetchImpl, loadDotEnv: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const p of ['game_passes', 'developer_products']) {
    for (const s of ['list', 'get', 'create', 'update', 'set_for_sale', 'bulk_create', 'bulk_update']) {
      assert.ok(names.includes(`${p}_${s}`), `missing ${p}_${s}`);
    }
  }
  assert.ok(names.includes('roblox_resources'));

  const r = await client.callTool({ name: 'game_passes_create', arguments: { name: 'X', price: 999, isForSale: true } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  assert.equal(JSON.parse(r.content[0].text).id, 5);

  const other = await client.callTool({ name: 'developer_products_list', arguments: { universeId: 42 } });
  assert.ok(!other.isError);
  assert.match(calls.at(-1).url, /universes\/42\//);

  const bad = await client.callTool({ name: 'game_passes_update', arguments: { id: 5 } });
  assert.equal(bad.isError, true);
  await client.close();
});
