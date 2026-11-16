import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRobloxConnect } from '../src/index.js';
import { createMcpServer } from '../src/mcp/server.js';

const reply = (status, data) => new Response(data == null ? null : JSON.stringify(data), { status });

async function tmpFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'rsc-test-'));
  const anim = join(dir, 'Quack.rbxmx');
  await writeFile(anim, '<roblox version="4"><Item class="KeyframeSequence" referent="RBX0"><Properties><string name="Name">Quack</string></Properties></Item></roblox>');
  const notAnim = join(dir, 'Model.rbxmx');
  await writeFile(notAnim, '<roblox version="4"><Item class="Model"></Item></roblox>');
  const fbx = join(dir, 'Duck.fbx');
  await writeFile(fbx, Buffer.from('Kaydara FBX Binary  \0'));
  return { anim, notAnim, fbx };
}

function assetsFetch({ introspect, status403 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: u.pathname, body });
    if (status403 && status403(init.method, u.pathname)) return reply(403, { message: 'Insufficient scope' });
    if (u.pathname === '/api-keys/v1/introspect') return introspect ? introspect(body) : reply(404, { message: 'not found' });
    if (init.method === 'POST' && u.pathname === '/assets/v1/assets') return reply(200, { path: 'operations/op-1', done: false });
    if (init.method === 'GET' && u.pathname === '/assets/v1/operations/op-1') {
      const req = JSON.parse(calls.find((c) => c.path === '/assets/v1/assets').body.request);
      return reply(200, { done: true, response: { assetId: '555', displayName: req.displayName, assetType: req.assetType, moderationResult: { moderationState: 'Approved' }, creationContext: req.creationContext } });
    }
    if (u.pathname.includes('/game-passes/')) return reply(200, { gamePasses: [], nextPageToken: '' });
    return reply(404, { message: 'nope' });
  };
  fn.calls = calls;
  return fn;
}

test('uploadAnimation sends Animation + group creator and returns the asset id', async () => {
  const { anim } = await tmpFiles();
  const fetchImpl = assetsFetch();
  const rc = createRobloxConnect({ apiKey: 'k', loadDotEnv: false, fetchImpl });
  const r = await rc.assets.uploadAnimation({ filePath: anim, groupId: '1234567' });
  assert.equal(r.assetId, '555');
  assert.equal(r.rbxassetid, 'rbxassetid://555');
  assert.equal(r.assetType, 'Animation');
  assert.equal(r.displayName, 'Quack');
  assert.equal(r.moderation, 'Approved');
  const post = fetchImpl.calls.find((c) => c.method === 'POST');
  const req = JSON.parse(post.body.request);
  assert.deepEqual(req.creationContext.creator, { groupId: '1234567' });
  assert.equal(post.body.fileContent.type, 'model/x-rbxm');
});

test('uploadModel sends Model with model/fbx', async () => {
  const { fbx } = await tmpFiles();
  const fetchImpl = assetsFetch();
  const rc = createRobloxConnect({ apiKey: 'k', loadDotEnv: false, fetchImpl });
  const r = await rc.assets.uploadModel({ filePath: fbx, displayName: 'VoxelDuck', userId: '1' });
  assert.equal(r.assetType, 'Model');
  const post = fetchImpl.calls.find((c) => c.method === 'POST');
  assert.equal(post.body.fileContent.type, 'model/fbx');
  assert.deepEqual(JSON.parse(post.body.request).creationContext.creator, { userId: '1' });
});

test('uploadAnimation rejects FBX and non-animation rbxmx before calling Roblox', async () => {
  const { fbx, notAnim } = await tmpFiles();
  const fetchImpl = assetsFetch();
  const rc = createRobloxConnect({ apiKey: 'k', loadDotEnv: false, fetchImpl });
  await assert.rejects(rc.assets.uploadAnimation({ filePath: fbx, groupId: '1' }), /FBX animation/);
  await assert.rejects(rc.assets.uploadAnimation({ filePath: notAnim, groupId: '1' }), /KeyframeSequence/);
  await assert.rejects(rc.assets.uploadModel({ filePath: 'C:/nope/missing.fbx', groupId: '1' }), /ไม่พบไฟล์/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('checkPermissions (introspect) lists missing scopes and wrong targets', async () => {
  const fetchImpl = assetsFetch({
    introspect: (body) => {
      assert.equal(body.apiKey, 'secret-key');
      return reply(200, {
        name: 'test-key', authorizedUserId: 7, enabled: true, expired: false,
        scopes: [
          { name: 'game-pass', operations: ['read', 'write'], universeIds: ['999'] },
          { name: 'asset', operations: ['read'] },
        ],
      });
    },
  });
  const rc = createRobloxConnect({ apiKey: 'secret-key', universeId: 10, loadDotEnv: false, fetchImpl });
  const r = await rc.checkPermissions({ groupId: '1234567' });
  assert.equal(r.method, 'introspect');
  assert.equal(r.ok, false);
  const byScope = Object.fromEntries(r.features.map((f) => [f.scope, f.status]));
  assert.equal(byScope['game-pass:read'], 'wrong-target');
  assert.equal(byScope['developer-product:write'], 'missing');
  assert.equal(byScope['asset:read'], 'ok');
  assert.equal(byScope['asset:write'], 'missing');
  assert.match(r.text, /asset:write/);
  assert.match(r.text, /dashboard\/credentials/);
  assert.ok(!r.text.includes('secret-key'), 'report must not contain the key');
});

test('checkPermissions reports ok when every scope is granted', async () => {
  const all = ['game-pass', 'developer-product', 'asset'].map((name) => ({ name, operations: ['read', 'write'], universeIds: ['*'] }));
  const fetchImpl = assetsFetch({ introspect: () => reply(200, { name: 'k', scopes: all }) });
  const rc = createRobloxConnect({ apiKey: 'k', universeId: 10, loadDotEnv: false, fetchImpl });
  const r = await rc.checkPermissions();
  assert.equal(r.ok, true, r.text);
  assert.equal(r.missing.length, 0);
});

test('checkPermissions says the key itself is unusable on 401 (not "missing scopes")', async () => {
  const fetchImpl = assetsFetch({ introspect: () => reply(401, { message: 'Invalid API Key secret.' }) });
  const rc = createRobloxConnect({ apiKey: 'k', universeId: 10, loadDotEnv: false, fetchImpl });
  const r = await rc.checkPermissions();
  assert.equal(r.ok, false);
  assert.equal(r.keyValid, false);
  assert.equal(r.missing.length, 0);
  assert.match(r.text, /API Key ใช้ไม่ได้/);
  assert.match(r.text, /Invalid API Key secret/);
});

test('MCP server starts without an API key; tools are listed and the check names ROBLOX_API_KEY', async () => {
  const saved = process.env.ROBLOX_API_KEY;
  delete process.env.ROBLOX_API_KEY;
  try {
    const server = createMcpServer({ universeId: 1, loadDotEnv: false, fetchImpl: assetsFetch() });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('assets_upload_animation'));
    const r = JSON.parse((await client.callTool({ name: 'roblox_check_permissions', arguments: {} })).content[0].text);
    assert.equal(r.ok, false);
    assert.match(r.reportForUser, /ROBLOX_API_KEY/);
    const up = await client.callTool({ name: 'assets_get', arguments: { id: 1 } });
    assert.equal(up.isError, true);
    assert.match(up.content[0].text, /ROBLOX_API_KEY/);
    await client.close();
  } finally {
    if (saved !== undefined) process.env.ROBLOX_API_KEY = saved;
  }
});

test('403 errors carry a Thai hint naming the missing scope', async () => {
  const fetchImpl = assetsFetch({ status403: (m, p) => m === 'POST' && p === '/assets/v1/assets' });
  const { anim } = await tmpFiles();
  const rc = createRobloxConnect({ apiKey: 'k', loadDotEnv: false, fetchImpl });
  await assert.rejects(rc.assets.uploadAnimation({ filePath: anim, groupId: '1' }), (err) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /asset:write/);
    assert.match(err.hint, /กลุ่ม/);
    return true;
  });
});

test('MCP exposes permission check and upload tools', async () => {
  const { anim } = await tmpFiles();
  const fetchImpl = assetsFetch({ introspect: () => reply(200, { name: 'k', scopes: [{ name: 'asset', operations: ['read', 'write'] }] }) });
  const server = createMcpServer({ apiKey: 'k', universeId: 1, fetchImpl, loadDotEnv: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ['roblox_check_permissions', 'assets_upload_model', 'assets_upload_animation', 'assets_operation', 'assets_get']) assert.ok(names.includes(n), `missing ${n}`);

  const perm = await client.callTool({ name: 'roblox_check_permissions', arguments: {} });
  const pr = JSON.parse(perm.content[0].text);
  assert.equal(pr.ok, false);
  assert.ok(pr.missing.some((m) => m.scope === 'game-pass:write'));
  assert.match(pr.reportForUser, /game-pass:write/);

  const up = await client.callTool({ name: 'assets_upload_animation', arguments: { filePath: anim, groupId: 1234567 } });
  assert.ok(!up.isError, up.content?.[0]?.text);
  assert.equal(JSON.parse(up.content[0].text).assetId, '555');
  await client.close();
});
