import { defineResource } from '../core/resource.js';
import { basename, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

// Docs: https://create.roblox.com/docs/cloud/guides/usage-assets
// Scopes: asset:read (ดูข้อมูล/รอผล operation), asset:write (อัปโหลด)
// อัปโหลดในนามกลุ่ม → API Key ต้องสร้างในหน้ากลุ่มนั้น; ไม่มีคำสั่งลบ asset ผ่าน API
// ประเภทที่ใช้บ่อย:
//   Model      .fbx .gltf .glb .rbxm .rbxmx  (FBX จะกลายเป็น MeshPart + กระดูก ถ้ามี rig)
//   Animation  .rbxm .rbxmx (KeyframeSequence) — FBX animation อัปโหลดตรงไม่ได้ ต้องแปลงเป็น .rbxmx ก่อน
//   Decal      .png .jpg .bmp .tga   | Audio .mp3 .ogg .wav .flac

const CONTENT_TYPES = {
  '.fbx': 'model/fbx', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
  '.rbxm': 'model/x-rbxm', '.rbxmx': 'model/x-rbxm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.tga': 'image/tga',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
};
const ALLOWED = {
  Model: ['.fbx', '.gltf', '.glb', '.rbxm', '.rbxmx'],
  Animation: ['.rbxm', '.rbxmx'],
  Decal: ['.png', '.jpg', '.jpeg', '.bmp', '.tga'],
  Audio: ['.mp3', '.ogg', '.wav', '.flac'],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollOperation(ctx, operationId, { timeoutMs = 180000, intervalMs = 2000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const op = await ctx.client.request('GET', `/assets/v1/operations/${operationId}`, { bucket: 'assets:read' });
    if (op?.done) {
      if (op.error) throw new Error(`Asset operation failed: ${JSON.stringify(op.error)}`);
      return op;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`Asset operation ${operationId} not done after ${timeoutMs / 1000}s (เช็กต่อด้วย assets operation ${operationId})`);
    await sleep(intervalMs);
  }
}

function creatorFrom(args) {
  const groupId = args.groupId ?? process.env.ROBLOX_GROUP_ID;
  const userId = args.userId ?? process.env.ROBLOX_USER_ID;
  if (!groupId && !userId) throw new Error('ต้องระบุ groupId หรือ userId (หรือตั้ง ROBLOX_GROUP_ID / ROBLOX_USER_ID ใน .env)');
  return groupId ? { groupId: String(groupId) } : { userId: String(userId) };
}

async function checkFile(filePath, assetType) {
  if (!filePath) throw new Error('filePath is required');
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`ไม่พบไฟล์: ${filePath}`);
  const ext = extname(filePath).toLowerCase();
  const allowed = ALLOWED[assetType];
  if (allowed && !allowed.includes(ext)) {
    const tip = assetType === 'Animation' && ext === '.fbx'
      ? ' — FBX animation อัปโหลดผ่าน Open Cloud ไม่ได้: แปลง Blender Action เป็น KeyframeSequence (.rbxmx) ก่อน หรือนำเข้าใน Animation Editor แล้ว Publish'
      : '';
    throw new Error(`${assetType} รับไฟล์ ${allowed.join(' ')} เท่านั้น (ได้ ${ext || 'ไม่มีนามสกุล'})${tip}`);
  }
  if (assetType === 'Animation' && ext === '.rbxmx') {
    const head = (await readFile(filePath, 'utf8')).slice(0, 4000);
    if (!/class="(KeyframeSequence|CurveAnimation)"/.test(head)) throw new Error('ไฟล์ .rbxmx นี้ไม่มี KeyframeSequence/CurveAnimation อยู่ด้านบนสุด — ไม่ใช่ไฟล์ Animation');
  }
  return { ext, size: info.size };
}

async function upload(ctx, args, assetType) {
  const { filePath } = args;
  const { ext } = await checkFile(filePath, assetType);
  const displayName = args.displayName || basename(filePath, extname(filePath));
  const creator = creatorFrom(args);
  const request = { assetType, displayName, description: args.description ?? '', creationContext: { creator } };
  const contentType = args.contentType || CONTENT_TYPES[ext] || 'application/octet-stream';
  const op = await ctx.client.request('POST', '/assets/v1/assets', {
    form: { request: JSON.stringify(request), fileContent: { filePath, contentType } },
    bucket: 'assets:write',
  });
  const operationId = op?.operationId || String(op?.path || '').split('/').pop();
  if (!operationId) throw new Error(`Unexpected create response: ${JSON.stringify(op)}`);
  if (args.wait === false) return { operationId, done: false, assetType, displayName, creator };
  const done = op.done ? op : await pollOperation(ctx, operationId, { timeoutMs: args.timeoutMs });
  const response = done.response || {};
  return {
    assetId: response.assetId, rbxassetid: response.assetId ? `rbxassetid://${response.assetId}` : null,
    operationId, displayName: response.displayName ?? displayName, assetType: response.assetType ?? assetType,
    moderation: response.moderationResult?.moderationState ?? response.moderationResult ?? null,
    creator: response.creationContext?.creator ?? creator,
  };
}

const commonFields = {
  filePath: { type: 'string', required: true, create: true, description: 'Local file to upload (absolute path).' },
  displayName: { type: 'string', create: true, description: 'Asset name (default: file name).' },
  description: { type: 'string', create: true, description: 'Asset description.' },
  groupId: { type: 'string', create: true, description: 'Upload as this group (API key must be created in that group). Defaults to ROBLOX_GROUP_ID.' },
  userId: { type: 'string', create: true, description: 'Upload as this user (when no groupId). Defaults to ROBLOX_USER_ID.' },
};

export default defineResource({
  key: 'assets',
  cliName: 'assets',
  title: 'Asset',
  description: 'Upload assets (Model .fbx/.gltf/.rbxm, Animation .rbxmx, Decal, Audio) and read asset info.',
  capabilities: { delete: false },
  fields: {
    ...commonFields,
    assetType: { type: 'string', required: true, create: true, description: 'Model | Animation | Decal | Audio' },
    contentType: { type: 'string', create: true, description: 'Override the file content type (default from extension).' },
  },
  uploadFields: commonFields,
  operations: {
    /** Upload any supported asset type and wait for the asset id. */
    async create(ctx, args = {}) {
      if (!args.assetType) throw new Error('assetType is required (Model | Animation | Decal | Audio)');
      return upload(ctx, args, args.assetType);
    },

    /** Upload a 3D model (.fbx/.gltf/.glb/.rbxm/.rbxmx) as a Model asset. */
    async uploadModel(ctx, args = {}) {
      return upload(ctx, args, 'Model');
    },

    /** Upload a KeyframeSequence (.rbxmx/.rbxm) as an Animation asset. */
    async uploadAnimation(ctx, args = {}) {
      return upload(ctx, args, 'Animation');
    },

    /** Asset info by id. */
    async get(ctx, args = {}) {
      if (!args.id) throw new Error('id is required');
      return ctx.client.request('GET', `/assets/v1/assets/${args.id}`, { bucket: 'assets:read' });
    },

    /** Poll one upload operation (when an upload timed out). */
    async operation(ctx, args = {}) {
      if (!args.id) throw new Error('id is required');
      return ctx.client.request('GET', `/assets/v1/operations/${args.id}`, { bucket: 'assets:read' });
    },
  },
});
