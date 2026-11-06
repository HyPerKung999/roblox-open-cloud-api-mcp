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
  const rc = createRobloxConnect(options);
  const server = new McpServer({ name: 'roblox-studio-connect', version: '0.1.0' });

  const pick = (universeId) => (universeId ? rc.forUniverse(universeId) : rc);
  const run = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

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
