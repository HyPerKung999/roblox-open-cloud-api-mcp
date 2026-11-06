#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createRobloxConnect } from '../src/index.js';

const HELP = `rsc - Roblox Studio Connect

Usage:
  rsc resources
  rsc <resource> list [--json]
  rsc <resource> get <id>
  rsc <resource> create --name <n> [--price <robux>] [--for-sale] [--description <d>] [--icon <file>]
  rsc <resource> update <id> [--name ..] [--price ..] [--description ..] [--icon ..] [--for-sale | --off-sale]
  rsc <resource> on-sale <id>
  rsc <resource> off-sale <id>
  rsc <resource> bulk-create <items.json> [--dry-run]
  rsc <resource> bulk-update <items.json>
  rsc <resource> export [--csv]

Resources: game-passes, developer-products
Global:   --universe <id>  (default ROBLOX_UNIVERSE_ID)
Key:      ROBLOX_API_KEY in the environment or in .env (never pass it on the command line)
`;

const { values: o, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    universe: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    price: { type: 'string' },
    icon: { type: 'string' },
    'for-sale': { type: 'boolean' },
    'off-sale': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    json: { type: 'boolean' },
    csv: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const print = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

function fieldsFromFlags() {
  const f = {};
  if (o.name !== undefined) f.name = o.name;
  if (o.description !== undefined) f.description = o.description;
  if (o.price !== undefined) {
    f.price = Number(o.price);
    if (!Number.isInteger(f.price) || f.price < 0) throw new Error('--price must be a whole number of Robux');
  }
  if (o.icon !== undefined) f.iconPath = o.icon;
  if (o['for-sale']) f.isForSale = true;
  if (o['off-sale']) f.isForSale = false;
  return f;
}

function table(items) {
  const rows = items.map((x) => [String(x.id), x.isForSale ? 'ON ' : 'off', String(x.price ?? '-').padStart(6), x.name]);
  return rows.map((r) => r.join('  ')).join('\n') + `\n(${items.length} items)`;
}

async function main() {
  const [resName, cmd, arg] = pos;
  if (o.help || !resName) return print(HELP);

  const rc = createRobloxConnect({ universeId: o.universe });
  if (resName === 'resources') {
    return print(Object.values(rc.resources).map(({ definition: d }) => `${d.cliName.padEnd(20)} ${d.title} - ${d.description}`).join('\n'));
  }
  const res = Object.values(rc.resources).find((r) => r.definition.cliName === resName);
  if (!res) throw new Error(`Unknown resource "${resName}". Try: rsc resources`);

  const progress = (i, n, r) => console.error(`[${i}/${n}] ${r.ok ? (r.skipped ? 'skip' : r.dryRun ? 'would create' : 'ok') : 'FAIL'} ${r.input.name ?? r.input.id}${r.error ? ` - ${r.error}` : ''}`);

  switch (cmd) {
    case 'list': {
      const items = await res.list();
      return print(o.json ? items : table(items));
    }
    case 'get': return print(await res.get({ id: arg }));
    case 'create': return print(await res.create(fieldsFromFlags()));
    case 'update': return print(await res.update({ id: arg, ...fieldsFromFlags() }));
    case 'on-sale': return print(await res.setForSale({ id: arg, isForSale: true }));
    case 'off-sale': return print(await res.setForSale({ id: arg, isForSale: false }));
    case 'bulk-create': {
      const items = JSON.parse(await readFile(arg, 'utf8'));
      const r = await res.bulkCreate({ items, dryRun: !!o['dry-run'], onProgress: progress });
      return print({ created: r.created, skipped: r.skipped, failed: r.failed, dryRun: r.dryRun, items: r.results.map((x) => ({ name: x.input.name, id: x.item?.id ?? null, ok: x.ok, skipped: !!x.skipped, error: x.error })) });
    }
    case 'bulk-update': {
      const items = JSON.parse(await readFile(arg, 'utf8'));
      const r = await res.bulkUpdate({ items, onProgress: progress });
      return print({ updated: r.updated, failed: r.failed, items: r.results.map((x) => ({ id: x.input.id, ok: x.ok, error: x.error })) });
    }
    case 'export': {
      const items = await res.list();
      if (o.csv) {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return print(['id,name,price,isForSale', ...items.map((x) => [x.id, esc(x.name), x.price ?? '', x.isForSale].join(','))].join('\n'));
      }
      return print(Object.fromEntries(items.map((x) => [x.name, x.id])));
    }
    default:
      throw new Error(`Unknown command "${cmd ?? ''}".\n\n${HELP}`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
