# Roblox Studio Connect

จัดการของบน Roblox ผ่าน Open Cloud API ด้วย JS ใช้ได้ 3 แบบ:

1. **Module**: `import { createRobloxConnect } from 'roblox-studio-connect'`
2. **CLI**: `rsc ...`
3. **MCP server**: ให้ Claude หรือ AI ตัวอื่นเรียกใช้

ตอนนี้รองรับ **Game Pass**, **Developer Product** และ **อัปโหลด Asset** (โมเดล 3D `.fbx/.gltf/.glb/.rbxm`, Animation `.rbxmx`) พร้อม **ตัวตรวจสิทธิ์ API Key** ที่บอกว่าขาดสิทธิ์อะไร ส่วนระบบอื่นเพิ่มทีหลังได้ (ดูหัวข้อ "เพิ่มระบบใหม่")

> Roblox ไม่มีคำสั่งลบ Game Pass และ Developer Product คำสั่ง `remove` / `off-sale` ในโปรแกรมนี้จึงเป็นการ **ปิดขาย** แทน

## ติดตั้ง

```bash
npm install
cp .env.template .env
```

ใส่ค่าในไฟล์ `.env` ด้วยตัวเอง (คำอธิบายเต็ม (ไทย + อังกฤษ) อยู่ใน `.env.template`):

- `ROBLOX_API_KEY`: สร้างที่ https://create.roblox.com/dashboard/credentials (อัปโหลดในนามกลุ่ม → สร้างคีย์ในหน้ากลุ่มนั้น)
- `ROBLOX_UNIVERSE_ID`: เกมเริ่มต้นสำหรับ Game Pass / Developer Product (Creator Dashboard → เกม → "Copy Universe ID")
- `ROBLOX_GROUP_ID` หรือ `ROBLOX_USER_ID`: เจ้าของ asset ที่อัปโหลด (แนะนำกลุ่มที่เป็นเจ้าของเกม)

### สิทธิ์ที่ต้องกดอนุญาตให้ API Key (Access Permissions → Add API System)

| ระบบที่จะใช้ | API System | ติ๊ก | เลือก resource |
|---|---|---|---|
| Game Pass | `game-pass` | Read + Write | เกมที่จะจัดการ |
| Developer Product | `developer-product` | Read + Write | เกมที่จะจัดการ |
| อัปโหลดโมเดล 3D | `asset` | Read + Write | – (คีย์ของกลุ่มเจ้าของ) |
| อัปโหลด Animation | `asset` | Read + Write | – (คีย์ของกลุ่มเจ้าของ) |

`asset` ต้องมี Read ด้วย เพราะหลังอัปโหลดต้องอ่านผล operation เพื่อเอา `assetId` กลับมา
ถ้ามี IP ที่ใช้ประจำ ให้ตั้งไว้ในหัวข้อ Security ด้วย

### ตรวจว่าคีย์ขาดสิทธิ์อะไร

```bash
node bin/rsc.js permissions                 # ใช้เกม/กลุ่มจาก .env
node bin/rsc.js permissions --universe 123 --group 456 --json
```

ถาม Roblox ตรงๆ (`POST /api-keys/v1/introspect`) ว่าคีย์มี scope อะไร ผูกกับเกม/กลุ่มไหน แล้วแสดง ✅/❌/⚠️ ต่อสิทธิ์ พร้อมสรุปว่า**ขาดอะไร**และวิธีไปกดเพิ่ม (exit code 1 ถ้าขาด)
- ถ้าคีย์ใช้ไม่ได้ (401) จะบอกว่า "API Key ใช้ไม่ได้" แทนการบอกว่าขาดสิทธิ์
- ทุกคำสั่งที่โดน 401/403 จะมีบรรทัด `[สิทธิ์] น่าจะขาดสิทธิ์ "..."` ต่อท้าย error ให้ด้วย

ห้ามส่ง API Key ในแชต ห้ามใส่ในโค้ด และห้าม commit ไฟล์ `.env` (ไฟล์นี้อยู่ใน `.gitignore` แล้ว)

## Module

```js
import { createRobloxConnect } from './src/index.js';

const rc = createRobloxConnect();               // อ่าน key และ universe จาก .env
const passes = await rc.gamePasses.list();       // [{ id, name, price, isForSale, ... }]
const p = await rc.developerProducts.create({ name: '100 Coins', price: 99, isForSale: true, iconPath: './icon.png' });
await rc.developerProducts.setPrice({ id: p.id, price: 149 });
await rc.gamePasses.setForSale({ id: 123, isForSale: false });
const other = rc.forUniverse(999999);            // เกมอื่น
```

ทุก resource มีคำสั่งเหมือนกัน:

| คำสั่ง | หน้าที่ |
|---|---|
| `list` | ดูรายการทั้งหมด (ไล่ทุกหน้าให้เอง) |
| `listPage` | ดูทีละหน้า |
| `get` | ดูรายการเดียวตาม id |
| `findByName` | หาตามชื่อ |
| `create` | สร้างใหม่ |
| `update` | แก้ไข |
| `setPrice` | เปลี่ยนราคา |
| `setForSale` | เปิดหรือปิดขาย |
| `remove` | ปิดขาย |
| `bulkCreate` | สร้างทีละหลายรายการ ชื่อที่มีอยู่แล้วจะข้ามให้ จึงรันซ้ำได้ มี `dryRun` ให้ดูก่อนสร้างจริง |
| `bulkUpdate` | แก้ไขทีละหลายรายการ |

ฟิลด์ที่ใช้ได้:
- `name`
- `description`
- `price` (Robux)
- `isForSale`
- `iconPath` (ไฟล์รูปในเครื่อง)
- `isRegionalPricingEnabled`
- `storePageEnabled` (ใช้กับ Developer Product และใช้ได้เฉพาะตอน update)

โปรแกรมทำสองอย่างนี้ให้อัตโนมัติ:
- จำกัดความเร็วไม่ให้เกิน rate limit ของ Roblox: Game Pass เขียนได้ 5 ครั้ง/วินาที Developer Product 3 ครั้ง/วินาที
- ถ้าเจอ 429 หรือ 5xx จะลองใหม่ให้เอง

## CLI

```bash
node bin/rsc.js resources
node bin/rsc.js game-passes list
node bin/rsc.js developer-products create --name "1 Aura Spin" --price 999 --for-sale
node bin/rsc.js game-passes update 123456 --price 499 --icon ./icon.png
node bin/rsc.js game-passes off-sale 123456
node bin/rsc.js developer-products bulk-create items.json --dry-run      # ดูก่อนว่าจะสร้างอะไร
node bin/rsc.js developer-products bulk-create items.json
node bin/rsc.js game-passes bulk-update updates.json
node bin/rsc.js developer-products export          # { "ชื่อ": id }
node bin/rsc.js game-passes export --csv

node bin/rsc.js permissions
node bin/rsc.js assets upload-model "E:/path/VoxelDuck.fbx" --name VoxelDuck            # กลุ่มจาก ROBLOX_GROUP_ID
node bin/rsc.js assets upload-animation "E:/path/Quack.rbxmx" --name MyDuck_Quack --group 1234567
node bin/rsc.js assets get 115715787591006
node bin/rsc.js assets operation <operationId>                                          # ถ้าอัปโหลดแล้วรอนานเกิน
```

อัปโหลด asset เป็นของถาวรและผ่าน moderation ของ Roblox (ลบผ่าน API ไม่ได้) ผลที่ได้: `{ assetId, rbxassetid, assetType, moderation, creator }`
- Animation รับเฉพาะ `.rbxmx/.rbxm` ที่เป็น KeyframeSequence — FBX animation อัปโหลดตรงไม่ได้ (โปรแกรมจะเตือนก่อนส่ง)
- Module: `await rc.assets.uploadModel({ filePath, displayName })`, `await rc.assets.uploadAnimation({ filePath, groupId })`, `await rc.checkPermissions()`

ถ้าจะใช้เกมอื่น ให้เพิ่ม `--universe <id>`

## MCP server (Claude และ AI อื่น)

ใส่ในไฟล์ตั้งค่า MCP ของโปรแกรมที่ใช้ เช่น Claude Desktop, Claude Code หรือ Cursor:

```json
{
  "mcpServers": {
    "roblox-studio-connect": {
      "command": "node",
      "args": ["E:/Github/Java Script/roblox-open-cloud-api-mcp/bin/rsc-mcp.js"]
    }
  }
}
```

Key จะอ่านจาก `.env` ในโฟลเดอร์โปรเจกต์ จึงไม่ต้องใส่ Key ในไฟล์ตั้งค่า MCP

Tools ที่ได้:
- `roblox_check_permissions` ตรวจสิทธิ์คีย์ คืน `missing` + `reportForUser` (ภาษาไทย) ให้ Claude บอกคนทำว่าต้องไปกดอนุญาตอะไร
- `assets_upload_model`, `assets_upload_animation`, `assets_get`, `assets_operation`, `assets_create`

ของ Game Pass / Developer Product (ชื่อ resource คือ `game_passes` และ `developer_products`):
- `roblox_resources`
- `<resource>_list`
- `<resource>_get`
- `<resource>_create`
- `<resource>_update`
- `<resource>_set_for_sale`
- `<resource>_bulk_create`
- `<resource>_bulk_update`

tool ของ Game Pass / Developer Product รับ `universeId` ได้ ถ้าไม่ใส่จะใช้ค่าจาก `.env`

เซิร์ฟเวอร์ส่งคำแนะนำ (instructions) ให้ Claude: ให้เรียก `roblox_check_permissions` ก่อนเขียนครั้งแรกและทุกครั้งที่เจอ 401/403 แล้วบอกผู้ใช้ว่าขาด scope ไหน และให้ยืนยันกับผู้ใช้ก่อนอัปโหลด asset

## เพิ่มระบบใหม่ (เช่น Badges, Data Stores, Places)

1. สร้างไฟล์ `src/resources/<ชื่อ>.js` แล้ว export `defineResource({ key, cliName, title, description, fields, operations })`
   - `operations` แต่ละตัวมีรูปแบบ `async (ctx, args) => ...`
   - `ctx` มี `client` (ใช้เรียก `ctx.client.request(method, path, { query, json, form, bucket })`) และ `universeId`
2. เพิ่มชื่อลงใน `src/resources/index.js`

แค่นี้ Module, CLI และ MCP จะมีคำสั่งของระบบใหม่ให้เอง
- ถ้าตั้งชื่อ operation ตามชุดมาตรฐาน (`list`, `get`, `create`, `update`, `setForSale`, `bulkCreate`, `bulkUpdate`) MCP จะสร้าง tool ให้อัตโนมัติ
- ถ้าเป็น operation แบบอื่น ให้เพิ่ม tool เองใน `src/mcp/server.js`

ถ้าไม่อยากแก้ไฟล์ของโปรเจกต์ ก็ส่ง resource เข้าไปตอนเรียกใช้แทนได้:
```js
createRobloxConnect({ resources: [myBadges] })
```

## ทดสอบ

```bash
npm test
```

ชุดทดสอบใช้ Roblox API จำลอง จึงไม่ต้องใช้ Key จริง

## รูปแบบไฟล์ JSON สำหรับ bulk

`bulk-create` (ชื่อที่มีอยู่แล้วจะข้าม จึงรันซ้ำได้):
```json
[
  { "name": "100 Coins", "description": "Adds 100 coins", "price": 99, "isForSale": true, "iconPath": "./icons/coins.png" },
  { "name": "VIP", "price": 499, "isForSale": true }
]
```

`bulk-update` (ต้องมี `id` ใส่เฉพาะฟิลด์ที่จะเปลี่ยน):
```json
[
  { "id": 123456, "price": 149 },
  { "id": 789012, "isForSale": false, "iconPath": "./icons/vip.png" }
]
```
