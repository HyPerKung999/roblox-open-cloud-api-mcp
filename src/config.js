import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load .env (project root, then current folder) without overriding values that
 * are already set in the environment. Uses Node's built-in loader.
 */
export function loadEnv() {
  for (const p of [resolve(process.cwd(), '.env'), resolve(ROOT, '.env')]) {
    if (existsSync(p)) {
      try { process.loadEnvFile(p); } catch { /* ignore bad file */ }
    }
  }
}

/** Settings from options first, then environment. */
export function resolveConfig(opts = {}) {
  return {
    apiKey: opts.apiKey ?? process.env.ROBLOX_API_KEY,
    universeId: opts.universeId ?? process.env.ROBLOX_UNIVERSE_ID,
    baseUrl: opts.baseUrl ?? process.env.ROBLOX_API_BASE_URL ?? undefined,
  };
}
