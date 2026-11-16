import { OpenCloudClient } from './core/client.js';
import { bindResource } from './core/resource.js';
import { builtinResources } from './resources/index.js';
import { loadEnv, resolveConfig } from './config.js';
import { checkPermissions } from './core/permissions.js';

export { OpenCloudClient } from './core/client.js';
export { checkPermissions, FEATURES as PERMISSION_FEATURES, permissionHint } from './core/permissions.js';
export { RobloxApiError, ConfigError } from './core/errors.js';
export { defineResource } from './core/resource.js';
export { defineMonetizedResource } from './resources/_monetized.js';
export { builtinResources } from './resources/index.js';

/**
 * Create a connected toolkit.
 *
 *   import { createRobloxConnect } from 'roblox-studio-connect';
 *   const rc = createRobloxConnect({ universeId: 123 }); // apiKey from ROBLOX_API_KEY
 *   const passes = await rc.gamePasses.list();
 *   await rc.developerProducts.create({ name: '100 Coins', price: 99, isForSale: true });
 *
 * Options: apiKey, universeId, baseUrl, resources (extra definitions),
 * loadDotEnv (default true), fetchImpl, logger.
 */
export function createRobloxConnect(options = {}) {
  if (options.loadDotEnv !== false) loadEnv();
  const cfg = resolveConfig(options);
  const client = new OpenCloudClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, fetchImpl: options.fetchImpl, logger: options.logger, allowMissingKey: options.allowMissingKey });

  const defs = [...builtinResources, ...(options.resources || [])];
  const api = { client, universeId: cfg.universeId, resources: {} };

  for (const def of defs) {
    for (const [bucket, perSec] of Object.entries(def.rateLimits || {})) client.setRateLimit(bucket, perSec);
    const bound = bindResource(def, { client, universeId: cfg.universeId });
    api.resources[def.key] = bound;
    api[def.key] = bound;
  }

  /**
   * ตรวจว่า API Key มีสิทธิ์ครบไหม (ใช้ universe จาก .env และ ROBLOX_GROUP_ID เป็นค่าเริ่มต้น)
   * คืน { ok, missing, features, warnings, text } — text เป็นสรุปภาษาไทยพร้อมวิธีไปกดอนุญาต
   */
  api.checkPermissions = (opts = {}) => checkPermissions(client, {
    universeId: opts.universeId ?? cfg.universeId,
    groupId: opts.groupId ?? process.env.ROBLOX_GROUP_ID,
    features: opts.features,
  });

  /** Same toolkit pointed at another experience. */
  api.forUniverse = (universeId) => createRobloxConnect({ ...options, ...cfg, universeId, loadDotEnv: false });
  return api;
}

export default createRobloxConnect;
