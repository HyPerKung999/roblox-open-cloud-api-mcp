import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRobloxConnect } from '../index.js';

const snake = (s) => s.replace(/-/g, '_');

function zodFor(spec) {
  let t;
  switch (spec.type) {
    case 'integer': t = z.number().int().min(0); break;
    case 'number': t = z.number(); break;
    case 'boolean': t = z.boolean(); break;
    default: t = z.string();
  }
  return spec.description ? t.describe(spec.description) : t;
}

function shapeFor(def, mode) {
  const shape = {};
  for (const [name, spec] of Object.entries(def.fields || {})) {
    if (!spec[mode]) continue;
    const t = zodFor(spec);
    shape[name] = mode === 'create' && spec.required ? t : t.optional();
  }
  return shape;
}

const universeArg = { universeId: z.union([z.string(), z.number()]).optional().describe('Experience (universe) id. Defaults to ROBLOX_UNIVERSE_ID.') };
const idArg = { id: z.union([z.string(), z.number()]).describe('Item id') };

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: String(err?.message || err) }] });

/**
 * Build an MCP server exposing every registered resource.
 * Tool names: <resource>_list, _get, _create, _update, _set_for_sale,
 * _bulk_create, _bulk_update (e.g. game_passes_create).
 */
export function createMcpServer(options = {}) {
  // allowMissingKey: เปิด server ได้แม้ยังไม่ตั้งคีย์ → tool ยังขึ้นให้ Claude เห็น และ roblox_check_permissions บอกว่าต้องตั้ง ROBLOX_API_KEY
  const rc = createRobloxConnect({ allowMissingKey: true, ...options });
  const server = new McpServer({ name: 'roblox-studio-connect', version: '0.2.0' }, {
    instructions: [
      'Roblox Open Cloud: Game Passes, Developer Products, and asset uploads (3D models, Animations).',
      'Call roblox_check_permissions before the first write in a session and whenever a tool fails with 401/403.',
      'If it reports missing permissions, tell the user exactly which scopes are missing (the "missing" list and the Thai text) and that they must add them to the API key at https://create.roblox.com/dashboard/credentials — never ask for or handle the API key yourself.',
      'Asset uploads are permanent and go through moderation: confirm with the user what will be uploaded and under which creator (group/user) before calling assets_upload_*.',
    ].join(' '),
  });

  const pick = (universeId) => (universeId ? rc.forUniverse(universeId) : rc);
  const run = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

  server.registerTool('roblox_check_permissions', {
    title: 'Check API key permissions',
    description: 'Checks which Open Cloud scopes the configured API key has (game-pass, developer-product, asset read/write), whether it is bound to the experience/group, and lists what is missing with Thai instructions for the user. Run before writing, and after any 401/403.',
    inputSchema: {
      ...universeArg,
      groupId: z.union([z.string(), z.number()]).optional().describe('Group that owns uploads. Defaults to ROBLOX_GROUP_ID.'),
    },
    annotations: { readOnlyHint: true },
  }, run(async ({ universeId, groupId }) => {
    const r = await rc.checkPermissions({ universeId, groupId: groupId != null ? String(groupId) : undefined });
    return { ok: r.ok, keyValid: r.keyValid, method: r.method, key: r.key, missing: r.missing.map((m) => ({ scope: m.scope, purpose: m.purpose, note: m.note })), unknown: r.unknown.map((u) => u.scope), warnings: r.warnings, reportForUser: r.text };
  }));

  const uploadShape = {
    filePath: z.string().describe('Absolute path of the local file to upload.'),
    displayName: z.string().optional().describe('Asset name (default: file name).'),
    description: z.string().optional(),
    groupId: z.union([z.string(), z.number()]).optional().describe('Upload as this group (API key must be created in that group). Defaults to ROBLOX_GROUP_ID.'),
    userId: z.union([z.string(), z.number()]).optional().describe('Upload as this user instead of a group.'),
  };
  const norm = (a) => ({ ...a, groupId: a.groupId != null ? String(a.groupId) : undefined, userId: a.userId != null ? String(a.userId) : undefined });

  server.registerTool('assets_upload_model', {
    title: 'Upload 3D model',
    description: 'Upload a .fbx/.gltf/.glb/.rbxm/.rbxmx file as a Model asset and wait for the asset id (needs asset:write + asset:read). Permanent; goes through moderation.',
    inputSchema: uploadShape,
  }, run(async (a) => rc.assets.uploadModel(norm(a))));

  server.registerTool('assets_upload_animation', {
    title: 'Upload Animation',
    description: 'Upload a KeyframeSequence file (.rbxmx/.rbxm) as an Animation asset and wait for the asset id (needs asset:write + asset:read). FBX animations cannot be uploaded directly. Permanent; goes through moderation.',
    inputSchema: uploadShape,
  }, run(async (a) => rc.assets.uploadAnimation(norm(a))));

  server.registerTool('assets_operation', {
    title: 'Check asset upload operation',
    description: 'Poll an asset upload operation by id (use when an upload timed out).',
    inputSchema: { id: z.string().describe('Operation id') },
    annotations: { readOnlyHint: true },
  }, run(async ({ id }) => rc.assets.operation({ id })));

  server.registerTool('roblox_resources', {
    title: 'List supported Roblox resources',
    description: 'Shows which Roblox Open Cloud resources this server manages and their fields.',
    inputSchema: {},
  }, run(async () => Object.values(rc.resources).map(({ definition: d }) => ({
    name: snake(d.cliName), title: d.title, description: d.description,
    canDelete: d.capabilities?.delete !== false,
    fields: d.fields,
  }))));

  for (const { definition: def } of Object.values(rc.resources)) {
    const p = snake(def.cliName);
    const T = def.title;
    const res = (u) => pick(u)[def.key];
    const ops = def.operations;
    const noDelete = def.capabilities?.delete === false ? ` Roblox cannot delete a ${T}; take it off sale instead.` : '';

    if (ops.list) server.registerTool(`${p}_list`, {
      title: `List ${T}s`,
      description: `List every ${T} of the experience with id, name, price, sale state.`,
      inputSchema: { ...universeArg },
      annotations: { readOnlyHint: true },
    }, run(async ({ universeId }) => res(universeId).list()));

    if (ops.get) server.registerTool(`${p}_get`, {
      title: `Get ${T}`,
      description: `Get one ${T} by id.`,
      inputSchema: { ...universeArg, ...idArg },
      annotations: { readOnlyHint: true },
    }, run(async ({ universeId, id }) => res(universeId).get({ id })));

    if (ops.create) server.registerTool(`${p}_create`, {
      title: `Create ${T}`,
      description: `Create one ${T}.${noDelete}`,
      inputSchema: { ...universeArg, ...shapeFor(def, 'create') },
    }, run(async ({ universeId, ...a }) => res(universeId).create(a)));

    if (ops.update) server.registerTool(`${p}_update`, {
      title: `Update ${T}`,
      description: `Change fields of one ${T}. Only the fields you pass are changed.`,
      inputSchema: { ...universeArg, ...idArg, ...shapeFor(def, 'update') },
      annotations: { idempotentHint: true },
    }, run(async ({ universeId, ...a }) => res(universeId).update(a)));

    if (ops.setForSale) server.registerTool(`${p}_set_for_sale`, {
      title: `Put ${T} on/off sale`,
      description: `Turn sale on or off.${noDelete}`,
      inputSchema: { ...universeArg, ...idArg, isForSale: z.boolean() },
      annotations: { idempotentHint: true },
    }, run(async ({ universeId, id, isForSale }) => res(universeId).setForSale({ id, isForSale })));

    if (ops.bulkCreate) server.registerTool(`${p}_bulk_create`, {
      title: `Create many ${T}s`,
      description: `Create a list of ${T}s. Names that already exist are skipped, so re-running is safe. Use dryRun first to preview.`,
      inputSchema: {
        ...universeArg,
        items: z.array(z.object(shapeFor(def, 'create'))).min(1),
        dryRun: z.boolean().optional().describe('Only report what would be created.'),
      },
    }, run(async ({ universeId, items, dryRun }) => res(universeId).bulkCreate({ items, dryRun })));

    if (ops.bulkUpdate) server.registerTool(`${p}_bulk_update`, {
      title: `Update many ${T}s`,
      description: `Update a list of ${T}s: [{ id, ...fields }].`,
      inputSchema: {
        ...universeArg,
        items: z.array(z.object({ ...idArg, ...shapeFor(def, 'update') })).min(1),
      },
    }, run(async ({ universeId, items }) => res(universeId).bulkUpdate({ items })));
  }

  return server;
}

export async function startStdioServer(options = {}) {
  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}
