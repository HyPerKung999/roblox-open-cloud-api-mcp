import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { RobloxApiError, ConfigError } from './errors.js';
import { permissionHint } from './permissions.js';

const DEFAULT_BASE_URL = 'https://apis.roblox.com';
const MISSING_KEY = 'Missing API key: ตั้ง ROBLOX_API_KEY ในไฟล์ .env ของโปรเจกต์นี้ (หรือ environment) — Missing API key (set ROBLOX_API_KEY or pass { apiKey }).';
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.tga': 'image/x-tga' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Low-level Open Cloud HTTP client.
 * - API key goes in the x-api-key header (never logged).
 * - Retries 429 / 5xx with exponential backoff.
 * - Optional per-bucket throttle so bulk jobs stay under Roblox rate limits.
 */
export class OpenCloudClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, maxRetries = 4, fetchImpl = globalThis.fetch, logger = null, allowMissingKey = false } = {}) {
    // allowMissingKey: ให้ MCP server เปิดได้แม้ยังไม่ตั้งคีย์ (tool ยังขึ้น และบอกผู้ใช้ว่าต้องตั้งค่าอะไร) — เรียก API จริงจะ error ชัดเจน
    if (!apiKey && !allowMissingKey) throw new ConfigError(MISSING_KEY);
    this.#apiKey = apiKey || null;
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
  /** true ถ้าตั้งคีย์แล้ว */
  get hasApiKey() { return !!this.#apiKey; }

  async request(method, path, { query, json, form, bucket } = {}) {
    if (!this.#apiKey) throw new ConfigError(MISSING_KEY);
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
      const hint = res.status === 401 || res.status === 403 ? permissionHint(method, path, res.status) : null;
      throw new RobloxApiError({ status: res.status, method, path, body: data, hint });
    }
  }

  /**
   * ถาม Roblox ว่าคีย์นี้มีสิทธิ์อะไร (POST /api-keys/v1/introspect)
   * คีย์ถูกส่งใน body ไปที่ Roblox เท่านั้น ไม่ถูกคืนหรือ log
   */
  async introspect() {
    return this.request('POST', '/api-keys/v1/introspect', { json: { apiKey: this.#apiKey } });
  }
}

function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { type: 'image/png', ext: '.png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d) return { type: 'image/bmp', ext: '.bmp' };
  return null;
}

async function buildForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && v.filePath) {
      const buf = await readFile(v.filePath);
      // the file's own bytes decide the type (a PNG saved as ".jpg" must still go up as image/png)
      const sniffed = sniffImage(buf);
      // v.contentType: ใช้กับไฟล์ที่ไม่ใช่รูป (เช่น model/fbx สำหรับ Assets API) — รูปยังเดาจาก byte เหมือนเดิม
      const type = v.contentType || sniffed?.type || IMAGE_TYPES[extname(v.filePath).toLowerCase()] || 'application/octet-stream';
      let name = basename(v.filePath);
      if (sniffed && IMAGE_TYPES[extname(name).toLowerCase()] !== sniffed.type) name = name.slice(0, name.length - extname(name).length) + sniffed.ext;
      fd.append(k, new Blob([buf], { type }), name);
    } else {
      fd.append(k, String(v));
    }
  }
  return fd;
}
