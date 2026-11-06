// Error thrown for any non-2xx answer from Roblox Open Cloud.
export class RobloxApiError extends Error {
  constructor({ status, method, path, body }) {
    const detail =
      (body && (body.errorMessage || body.message || body.errors?.[0]?.message)) ||
      (typeof body === 'string' ? body.slice(0, 300) : '');
    super(`Roblox API ${method} ${path} -> ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'RobloxApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
    this.code = body?.errorCode ?? body?.code ?? null;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}
