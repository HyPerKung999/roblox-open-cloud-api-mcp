// Error thrown for any non-2xx answer from Roblox Open Cloud.
// hint: คำแนะนำภาษาไทยตอน 401/403 ว่าน่าจะขาดสิทธิ์ (scope) อะไร — ต่อท้ายข้อความให้ Claude/คนอ่านเห็นทันที
export class RobloxApiError extends Error {
  constructor({ status, method, path, body, hint = null }) {
    const detail =
      (body && (body.errorMessage || body.message || body.errors?.[0]?.message)) ||
      (typeof body === 'string' ? body.slice(0, 300) : '');
    super(`Roblox API ${method} ${path} -> ${status}${detail ? `: ${detail}` : ''}${hint ? `\n[สิทธิ์] ${hint}` : ''}`);
    this.name = 'RobloxApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
    this.hint = hint;
    this.code = body?.errorCode ?? body?.code ?? null;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}
