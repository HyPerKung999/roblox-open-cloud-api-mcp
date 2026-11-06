import { defineResource } from '../core/resource.js';

/**
 * Shared builder for Roblox "monetized items" (Game Passes and Developer
 * Products). Both Open Cloud APIs have the same shape: list / get / create /
 * update with multipart bodies. Roblox has NO delete for either; "remove"
 * here means taking the item off sale.
 */
export function defineMonetizedResource({
  key, cliName, title, description,
  basePath,           // (universeId) => '/game-passes/v1/universes/123/game-passes'
  listKey,            // 'gamePasses' | 'developerProducts'
  idField,            // 'gamePassId' | 'productId'
  iconField,          // 'iconAssetId' | 'iconImageAssetId'
  readRate, writeRate,
  extraUpdateFields = {},
}) {
  const fields = {
    name: { type: 'string', required: true, create: true, update: true, description: 'Display name (must be unique for developer products).' },
    description: { type: 'string', create: true, update: true, description: 'Description shown to players.' },
    price: { type: 'integer', create: true, update: true, description: 'Price in Robux.' },
    isForSale: { type: 'boolean', create: true, update: true, description: 'Whether it can be bought.' },
    iconPath: { type: 'string', create: true, update: true, description: 'Local image file (png/jpg) to upload as the icon.' },
    isRegionalPricingEnabled: { type: 'boolean', create: true, update: true, description: 'Enable regional pricing.' },
    ...extraUpdateFields,
  };

  const readBucket = `${cliName}:read`;
  const writeBucket = `${cliName}:write`;

  const normalize = (raw) => ({
    id: raw[idField],
    name: raw.name,
    description: raw.description ?? '',
    isForSale: !!raw.isForSale,
    price: raw.priceInformation?.defaultPriceInRobux ?? null,
    iconAssetId: raw[iconField] ?? null,
    createdAt: raw.createdTimestamp ?? null,
    updatedAt: raw.updatedTimestamp ?? null,
  });

  const toForm = (args, mode) => {
    const form = {};
    for (const [f, spec] of Object.entries(fields)) {
      if (!spec[mode] || args[f] === undefined) continue;
      if (f === 'iconPath') form.imageFile = { filePath: args.iconPath };
      else form[f] = args[f];
    }
    return form;
  };

  const ensureUniverse = (ctx) => {
    if (!ctx.universeId) throw new Error('universeId is required (set ROBLOX_UNIVERSE_ID or pass { universeId }).');
    return ctx.universeId;
  };

  const ops = {
    /** One page. */
    async listPage(ctx, { pageSize = 100, pageToken } = {}) {
      const u = ensureUniverse(ctx);
      const data = await ctx.client.request('GET', `${basePath(u)}/creator`, { query: { pageSize, pageToken }, bucket: readBucket });
      return { items: (data?.[listKey] || []).map(normalize), nextPageToken: data?.nextPageToken || null };
    },

    /** Every item (follows pagination). */
    async list(ctx, { pageSize = 100 } = {}) {
      const all = [];
      let pageToken;
      do {
        const page = await ops.listPage(ctx, { pageSize, pageToken });
        all.push(...page.items);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return all;
    },

    async get(ctx, { id }) {
      if (!id) throw new Error('id is required');
      const u = ensureUniverse(ctx);
      const data = await ctx.client.request('GET', `${basePath(u)}/${id}/creator`, { bucket: readBucket });
      return normalize(data);
    },

    async findByName(ctx, { name }) {
      const all = await ops.list(ctx);
      return all.filter((x) => x.name === name);
    },

    async create(ctx, args) {
      if (!args?.name) throw new Error('name is required');
      const u = ensureUniverse(ctx);
      const data = await ctx.client.request('POST', basePath(u), { form: toForm(args, 'create'), bucket: writeBucket });
      return normalize(data);
    },

    async update(ctx, { id, ...args }) {
      if (!id) throw new Error('id is required');
      const form = toForm(args, 'update');
      if (!Object.keys(form).length) throw new Error('nothing to update');
      const u = ensureUniverse(ctx);
      await ctx.client.request('PATCH', `${basePath(u)}/${id}`, { form, bucket: writeBucket });
      return ops.get(ctx, { id });
    },

    async setPrice(ctx, { id, price }) {
      return ops.update(ctx, { id, price });
    },

    async setForSale(ctx, { id, isForSale }) {
      return ops.update(ctx, { id, isForSale });
    },

    /** Roblox cannot delete these; this takes the item off sale. */
    async remove(ctx, { id }) {
      return ops.update(ctx, { id, isForSale: false });
    },

    /**
     * Create many. Items whose name already exists are skipped (returned with
     * skipped: true) so a re-run after a failure does not make duplicates.
     * dryRun: only report what would happen.
     */
    async bulkCreate(ctx, { items, dryRun = false, skipExisting = true, onProgress } = {}) {
      if (!Array.isArray(items) || !items.length) throw new Error('items must be a non-empty array');
      const existing = skipExisting ? await ops.list(ctx) : [];
      const byName = new Map(existing.map((x) => [x.name, x]));
      const results = [];
      for (const [i, item] of items.entries()) {
        const found = byName.get(item.name);
        let r;
        if (found) r = { ok: true, skipped: true, input: item, item: found };
        else if (dryRun) r = { ok: true, dryRun: true, input: item };
        else {
          try {
            const created = await ops.create(ctx, item);
            byName.set(created.name, created);
            r = { ok: true, input: item, item: created };
          } catch (err) {
            r = { ok: false, input: item, error: err.message };
          }
        }
        results.push(r);
        onProgress?.(i + 1, items.length, r);
      }
      return {
        created: results.filter((r) => r.ok && r.item && !r.skipped).length,
        skipped: results.filter((r) => r.skipped).length,
        failed: results.filter((r) => !r.ok).length,
        dryRun,
        results,
      };
    },

    /** Update many: [{ id, ...fields }]. */
    async bulkUpdate(ctx, { items, onProgress } = {}) {
      if (!Array.isArray(items) || !items.length) throw new Error('items must be a non-empty array');
      const results = [];
      for (const [i, item] of items.entries()) {
        let r;
        try { r = { ok: true, input: item, item: await ops.update(ctx, item) }; }
        catch (err) { r = { ok: false, input: item, error: err.message }; }
        results.push(r);
        onProgress?.(i + 1, items.length, r);
      }
      return { updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
    },
  };

  return defineResource({
    key, cliName, title, description, fields,
    capabilities: { delete: false },
    rateLimits: { [readBucket]: readRate, [writeBucket]: writeRate },
    operations: ops,
  });
}
