import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { RobloxApiError, ConfigError } from './errors.js';

const DEFAULT_BASE_URL = 'https://apis.roblox.com';
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.tga': 'image/x-tga' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Low-level Open Cloud HTTP client.
 * - API key goes in the x-api-key header (never logged).
 * - Retries 429 / 5xx with exponential backoff.
 * - Optional per-bucket throttle so bulk jobs stay under Roblox rate limits.
 */
export class OpenCloudClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, maxRetries = 4, fetchImpl = globalThis.fetch, logger = null } = {}) {
    if (!apiKey) throw new ConfigError('Missing API key (set ROBLOX_API_KEY or pass { apiKey }).');
    this.#apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.maxRetries = maxRetries;
    this.fetch = fetchImpl;
    this.logger = logger;
    this.buckets = new Map(); // bucket -> { minGapMs, next }
  }

  #apiKey;

  /** Limit calls in a bucket to `perSecond` (e.g. 'developer-products:write', 3). */
  setRateLimit(bucket, perSecond) {
    this.buckets.set(bucket, { minGapMs: Math.ceil(1000 / perSecond), next: 0 });
  }

  async #throttle(bucket) {
    const b = bucket && this.buckets.get(bucket);
    if (!b) return;
    const now = Date.now();
    const wait = Math.max(0, b.next - now);
    b.next = Math.max(now, b.next) + b.minGapMs;
    if (wait) await sleep(wait);
  }

  /**
   * @param {string} method
   * @param {string} path  path under the base URL, starting with '/'
   * @param {object} [opts]
   * @param {object} [opts.query]  query string values (undefined/null skipped)
   * @param {object} [opts.json]   JSON body
   * @param {object} [opts.form]   multipart fields; a value of { filePath } is uploaded as a file
   * @param {string} [opts.bucket] rate-limit bucket name
   */
  async request(method, path, { query, json, form, bucket } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    for (let attempt = 0; ; attempt++) {
      await this.#throttle(bucket);
      const headers = { 'x-api-key': this.#apiKey, accept: 'application/json' };
      let body;
      if (form) body = await buildForm(form);
      else if (json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(json);
      }

      const res = await this.fetch(url, { method, headers, body });
      const text = await res.text();
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }

      if (res.ok) return data;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        this.logger?.(`retry ${method} ${path} after ${delay}ms (status ${res.status})`);
        await sleep(delay);
        continue;
      }
      throw new RobloxApiError({ status: res.status, method, path, body: data });
    }
  }
}

async function buildForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && v.filePath) {
      const buf = await readFile(v.filePath);
      const type = IMAGE_TYPES[extname(v.filePath).toLowerCase()] || 'application/octet-stream';
      fd.append(k, new Blob([buf], { type }), basename(v.filePath));
    } else {
      fd.append(k, String(v));
    }
  }
  return fd;
}
