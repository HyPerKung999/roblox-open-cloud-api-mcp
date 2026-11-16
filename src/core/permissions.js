/**
 * สิทธิ์ (scope) ของ API Key ที่แต่ละระบบต้องใช้ + ตัวตรวจว่าคีย์ที่ใช้อยู่ขาดสิทธิ์อะไร
 *
 * - FEATURES: ระบบ → scope ที่ต้องติ๊กในหน้า Creator Dashboard → Open Cloud → API Keys → Access Permissions
 * - requiredScopeFor(method, path): ใช้ตอน Roblox ตอบ 401/403 เพื่อบอกว่าน่าจะขาด scope ไหน
 * - checkPermissions(): ถาม Roblox (POST /api-keys/v1/introspect) ว่าคีย์มี scope อะไร ผูกเกม/กลุ่มไหน
 *   แล้วสรุปเป็นภาษาไทยว่า "ขาดอะไร" ให้ Claude/คนอ่านแล้วไปกดอนุญาตต่อ
 *   ถ้า introspect ใช้ไม่ได้ จะลองเรียกแบบอ่านอย่างเดียวแทน (ตรวจสิทธิ์ write ไม่ได้ในโหมดนี้)
 */

export const DASHBOARD_URL = 'https://create.roblox.com/dashboard/credentials';

export const FEATURES = [
  {
    key: 'gamePasses', title: 'Game Pass', system: 'game-pass',
    ops: { read: 'ดูรายการ/รายละเอียด Game Pass', write: 'สร้าง/แก้ราคา/เปิด-ปิดขาย/เปลี่ยนไอคอน Game Pass' },
    needsUniverse: true, pathPrefix: '/game-passes/',
  },
  {
    key: 'developerProducts', title: 'Developer Product', system: 'developer-product',
    ops: { read: 'ดูรายการ/รายละเอียด Developer Product', write: 'สร้าง/แก้ราคา/เปิด-ปิดขาย/เปลี่ยนไอคอน Developer Product' },
    needsUniverse: true, pathPrefix: '/developer-products/',
  },
  {
    key: 'assets', title: 'Assets (อัปโหลดโมเดล / Animation / รูป / เสียง)', system: 'asset',
    ops: { read: 'ดูข้อมูล asset และรอผลการอัปโหลด (operation)', write: 'อัปโหลด asset ใหม่ เช่น โมเดล .fbx และ Animation .rbxmx' },
    needsUniverse: false, needsGroup: true, pathPrefix: '/assets/',
  },
];

/** scope ที่ request นี้ต้องใช้ (เดาจาก path + method) หรือ null */
export function requiredScopeFor(method, path) {
  const f = FEATURES.find((x) => path.startsWith(x.pathPrefix));
  if (!f) return null;
  const op = String(method).toUpperCase() === 'GET' ? 'read' : 'write';
  return { feature: f, scope: `${f.system}:${op}`, op };
}

/** ข้อความภาษาไทยตอนโดน 401/403 */
export function permissionHint(method, path, status) {
  const need = requiredScopeFor(method, path);
  if (status === 401) return 'API Key ใช้ไม่ได้ (ผิด/หมดอายุ/ถูกปิด หรือ IP นี้ไม่อยู่ในรายการที่อนุญาต) — ตรวจคีย์ที่ ' + DASHBOARD_URL;
  if (!need) return 'คีย์ไม่มีสิทธิ์ทำคำสั่งนี้ — รัน `rsc permissions` เพื่อดูว่าขาดอะไร';
  const extra = need.feature.needsUniverse ? ' และต้องเลือกเกม (Experience) นี้ไว้ใน scope ด้วย' : need.feature.needsGroup ? ' และถ้าอัปโหลดในนามกลุ่ม คีย์ต้องสร้างในหน้ากลุ่มนั้น' : '';
  return `น่าจะขาดสิทธิ์ "${need.scope}" (${need.feature.ops[need.op]})${extra} — ไปเพิ่มที่ ${DASHBOARD_URL} หรือรัน \`rsc permissions\``;
}

// ---- อ่านผล introspect (รองรับหลายรูปแบบ เพราะ Roblox อาจเปลี่ยนชื่อฟิลด์) ----
function scopeEntries(intro) {
  const out = []; // { system, op, universes:Set|null, groups:Set|null }
  const list = intro?.scopes || intro?.permissions || [];
  for (const s of list) {
    if (typeof s === 'string') {
      const [system, op] = s.split(':');
      out.push({ system, op: op || '*', universes: null, groups: null });
      continue;
    }
    const name = s.name || s.scopeType || s.scope || '';
    const ops = s.operations || s.ops || (name.includes(':') ? [name.split(':')[1]] : ['*']);
    const system = name.split(':')[0];
    const collect = (...keys) => {
      const vals = keys.flatMap((k) => (Array.isArray(s[k]) ? s[k] : []));
      return vals.length ? new Set(vals.map(String)) : null;
    };
    const universes = collect('universeIds', 'universes', 'universe_ids', 'targetParts');
    const groups = collect('groupIds', 'groups', 'group_ids');
    for (const op of ops) out.push({ system, op: String(op).toLowerCase(), universes, groups });
  }
  return out;
}

const covers = (set, id) => !set || set.has('*') || (id != null && set.has(String(id))) || [...set].some((x) => x.endsWith(`:${id}`) || x === `U:${id}`);

/**
 * ตรวจสิทธิ์ของคีย์
 * @returns {{ ok, method:'introspect'|'probe', key, features:[...], missing:[...], warnings:[...], text }}
 */
export async function checkPermissions(client, { universeId, groupId, features } = {}) {
  const wanted = FEATURES.filter((f) => !features || features.includes(f.key) || features.includes(f.system));
  const warnings = [];
  if (client.hasApiKey === false) {
    const results = wanted.flatMap((f) => ['read', 'write'].map((op) => ({ feature: f.key, title: f.title, scope: `${f.system}:${op}`, purpose: f.ops[op], status: 'unknown', note: 'ตรวจไม่ได้จนกว่าจะตั้งคีย์' })));
    const msg = `ยังไม่ได้ตั้ง ROBLOX_API_KEY — ใส่คีย์ในไฟล์ .env ของ roblox-open-cloud-api-mcp (หรือ environment) แล้วเปิด Claude Code ใหม่ (สร้างคีย์ที่ ${DASHBOARD_URL})`;
    return { ok: false, method: 'none', keyValid: false, keyMissing: true, missingEnv: ['ROBLOX_API_KEY'], key: null, universeId: universeId ?? null, groupId: groupId ?? null, features: results, missing: [], unknown: results, warnings: [msg], text: ['❌ ' + msg, '', 'สิทธิ์ที่คีย์ต้องมี: asset (Read+Write) สำหรับอัปโหลดโมเดล/Animation, game-pass / developer-product (Read+Write + เลือกเกม) สำหรับร้านค้า'].join('\n') };
  }
  let intro = null;
  let keyProblem = null;
  try {
    intro = await client.introspect();
  } catch (err) {
    const detail = (err.body && (err.body.message || err.body.errorMessage)) || err.message.split('\n')[0];
    if (err.status === 401) {
      keyProblem = `Roblox ปฏิเสธคีย์นี้ (401: ${detail}) — คีย์ผิด ถูกสร้างใหม่/ลบไปแล้ว หมดอายุ ถูกปิด หรือ IP เครื่องนี้ไม่อยู่ในรายการที่อนุญาต → สร้าง/คัดลอกคีย์ใหม่ใส่ ROBLOX_API_KEY ใน .env (${DASHBOARD_URL})`;
    } else {
      warnings.push(`ถาม Roblox เรื่องสิทธิ์ของคีย์ไม่ได้ (${err.status ?? ''} ${detail}) — เปลี่ยนไปลองเรียกแบบอ่านอย่างเดียวแทน`);
    }
  }
  if (keyProblem) {
    const results = wanted.flatMap((f) => ['read', 'write'].map((op) => ({ feature: f.key, title: f.title, scope: `${f.system}:${op}`, purpose: f.ops[op], status: 'unknown', note: 'ตรวจไม่ได้จนกว่าคีย์จะใช้ได้' })));
    const text = [`❌ API Key ใช้ไม่ได้`, keyProblem, '', 'แก้คีย์ก่อน แล้วรัน `rsc permissions` อีกครั้งเพื่อตรวจสิทธิ์ทีละระบบ'].join('\n');
    return { ok: false, method: 'introspect', keyValid: false, key: null, universeId: universeId ?? null, groupId: groupId ?? null, features: results, missing: [], unknown: results, warnings: [keyProblem], text };
  }

  const results = [];
  if (intro) {
    const entries = scopeEntries(intro);
    if (intro.enabled === false) warnings.push('คีย์นี้ถูกปิดใช้งานอยู่ (Disabled)');
    if (intro.expired === true) warnings.push('คีย์นี้หมดอายุแล้ว');
    for (const f of wanted) {
      for (const op of ['read', 'write']) {
        const hits = entries.filter((e) => e.system === f.system && (e.op === op || e.op === '*'));
        let status = hits.length ? 'ok' : 'missing';
        let note = '';
        if (hits.length && f.needsUniverse && universeId && !hits.some((h) => covers(h.universes, universeId))) {
          status = 'wrong-target'; note = `มี scope แต่ไม่ได้เลือกเกม ${universeId}`;
        }
        if (hits.length && f.needsGroup && groupId && hits.every((h) => h.groups) && !hits.some((h) => covers(h.groups, groupId))) {
          status = 'wrong-target'; note = `มี scope แต่ไม่ได้ผูกกับกลุ่ม ${groupId}`;
        }
        results.push({ feature: f.key, title: f.title, scope: `${f.system}:${op}`, purpose: f.ops[op], status, note });
      }
    }
  } else {
    // โหมดสำรอง: ลองเรียกอ่าน (ไม่สร้าง/แก้อะไร)
    const probe = async (fn) => {
      try { await fn(); return 'ok'; } catch (e) { return e.status === 403 ? 'missing' : e.status === 404 ? 'ok' : `error ${e.status ?? ''}`; }
    };
    for (const f of wanted) {
      let read = 'unknown';
      if (f.key === 'gamePasses' && universeId) read = await probe(() => client.request('GET', `/game-passes/v1/universes/${universeId}/game-passes/creator`, { query: { pageSize: 1 } }));
      if (f.key === 'developerProducts' && universeId) read = await probe(() => client.request('GET', `/developer-products/v2/universes/${universeId}/developer-products/creator`, { query: { pageSize: 1 } }));
      if (f.key === 'assets') read = await probe(() => client.request('GET', '/assets/v1/operations/00000000-0000-0000-0000-000000000000'));
      results.push({ feature: f.key, title: f.title, scope: `${f.system}:read`, purpose: f.ops.read, status: read, note: read === 'unknown' ? 'ต้องรู้ universeId ก่อนจึงตรวจได้' : '' });
      results.push({ feature: f.key, title: f.title, scope: `${f.system}:write`, purpose: f.ops.write, status: 'unknown', note: 'ตรวจ write ไม่ได้โดยไม่สร้างของจริง' });
    }
  }

  const missing = results.filter((r) => r.status !== 'ok' && r.status !== 'unknown');
  const unknown = results.filter((r) => r.status === 'unknown');
  const key = intro ? {
    name: intro.name ?? null,
    ownerUserId: intro.authorizedUserId ?? intro.userId ?? null,
    enabled: intro.enabled ?? null,
    expired: intro.expired ?? null,
  } : null;
  const ok = missing.length === 0 && warnings.filter((w) => !w.startsWith('ถาม Roblox')).length === 0;
  return { ok, method: intro ? 'introspect' : 'probe', keyValid: true, key, universeId: universeId ?? null, groupId: groupId ?? null, features: results, missing, unknown, warnings, text: formatReport({ ok, key, results, missing, unknown, warnings, universeId, groupId }) };
}

function formatReport({ ok, key, results, missing, unknown, warnings, universeId, groupId }) {
  const icon = { ok: '✅', missing: '❌', 'wrong-target': '⚠️', unknown: '❔' };
  const lines = [];
  lines.push(key ? `API Key: ${key.name ?? '(ไม่มีชื่อ)'}${key.ownerUserId ? ` (ผู้สร้าง userId ${key.ownerUserId})` : ''}` : 'API Key: (ตรวจแบบเรียกทดลอง)');
  lines.push(`เกม (universe): ${universeId ?? '-'} | กลุ่ม (group): ${groupId ?? '-'}`);
  for (const w of warnings) lines.push(`⚠️ ${w}`);
  for (const r of results) lines.push(`${icon[r.status] ?? '❔'} ${r.scope.padEnd(24)} ${r.purpose}${r.note ? ` — ${r.note}` : ''}`);
  if (ok && !unknown.length) lines.push('สรุป: สิทธิ์ครบทุกระบบ');
  if (missing.length) {
    lines.push('', 'สรุป: ยังขาดสิทธิ์ต่อไปนี้ (ให้คนทำไปกดอนุญาตเพิ่ม):');
    for (const m of missing) lines.push(`- ${m.scope}: ${m.purpose}${m.note ? ` (${m.note})` : ''}`);
    lines.push(`วิธีเพิ่ม: ${DASHBOARD_URL} → เลือกคีย์ → Edit → Access Permissions → เลือก API System ตามชื่อด้านหน้า ":" → ติ๊ก Read/Write → (Game Pass/Developer Product ให้เลือกเกมด้วย) → Save`);
  }
  if (unknown.length) lines.push('', `ตรวจไม่ได้: ${unknown.map((u) => u.scope).join(', ')}`);
  return lines.join('\n');
}
