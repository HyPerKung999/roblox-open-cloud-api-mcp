import { OpenCloudClient } from './core/client.js';
import { bindResource } from './core/resource.js';
import { builtinResources } from './resources/index.js';
import { loadEnv, resolveConfig } from './config.js';

export { OpenCloudClient } from './core/client.js';
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
  const client = new OpenCloudClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, fetchImpl: options.fetchImpl, logger: options.logger });

  const defs = [...builtinResources, ...(options.resources || [])];
  const api = { client, universeId: cfg.universeId, resources: {} };

  for (const def of defs) {
    for (const [bucket, perSec] of Object.entries(def.rateLimits || {})) client.setRateLimit(bucket, perSec);
    const bound = bindResource(def, { client, universeId: cfg.universeId });
    api.resources[def.key] = bound;
    api[def.key] = bound;
  }

  /** Same toolkit pointed at another experience. */
  api.forUniverse = (universeId) => createRobloxConnect({ ...options, ...cfg, universeId, loadDotEnv: false });
  return api;
}

export default createRobloxConnect;
