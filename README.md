# Roblox Studio Connect

จัดการของบน Roblox ผ่าน Open Cloud API ด้วย JS ใช้ได้ 3 แบบ:

1. **Module**: `import { createRobloxConnect } from 'roblox-studio-connect'`
2. **CLI**: `rsc ...`
3. **MCP server**: ให้ Claude หรือ AI ตัวอื่นเรียกใช้

ตอนนี้รองรับ **Game Pass** และ **Developer Product** แล้ว ส่วนระบบอื่นเพิ่มทีหลังได้ (ดูหัวข้อ "เพิ่มระบบใหม่")

> Roblox ไม่มีคำสั่งลบ Game Pass และ Developer Product คำสั่ง `remove` / `off-sale` ในโปรแกรมนี้จึงเป็นการ **ปิดขาย** แทน

## ติดตั้ง

```bash
npm install
cp .env.example .env
```

ใส่ค่าในไฟล์ `.env` ด้วยตัวเอง:

- `ROBLOX_API_KEY`: สร้างที่ https://create.roblox.com/dashboard/credentials
  - ให้สิทธิ์แค่ `game-pass` (read, write) และ `developer-product` (read, write)
  - จำกัดให้ใช้ได้แค่เกมที่ต้องการ
  - ถ้ามี IP ที่ใช้ประจำ ให้ตั้ง IP ไว้ด้วย
- `ROBLOX_UNIVERSE_ID`: เกมที่จะใช้เป็นค่าเริ่มต้น (ของ Soap Rush คือ `10770155309`)

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
node bin/rsc.js developer-products bulk-create examples/soaprush/developer-products.json --dry-run
node bin/rsc.js developer-products export          # { "ชื่อ": id }
node bin/rsc.js game-passes export --csv
```

ถ้าจะใช้เกมอื่น ให้เพิ่ม `--universe <id>`

## MCP server (Claude และ AI อื่น)

ใส่ในไฟล์ตั้งค่า MCP ของโปรแกรมที่ใช้ เช่น Claude Desktop, Claude Code หรือ Cursor:

```json
{
  "mcpServers": {
    "roblox-studio-connect": {
      "command": "node",
      "args": ["E:/Github/Bot Js/Roblox Studio Connect/bin/rsc-mcp.js"]
    }
  }
}
```

Key จะอ่านจาก `.env` ในโฟลเดอร์โปรเจกต์ จึงไม่ต้องใส่ Key ในไฟล์ตั้งค่า MCP

Tools ที่ได้ (ชื่อ resource คือ `game_passes` และ `developer_products`):
- `roblox_resources`
- `<resource>_list`
- `<resource>_get`
- `<resource>_create`
- `<resource>_update`
- `<resource>_set_for_sale`
- `<resource>_bulk_create`
- `<resource>_bulk_update`

ทุก tool รับ `universeId` ได้ ถ้าไม่ใส่จะใช้ค่าจาก `.env`

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

## ไฟล์ตัวอย่าง Soap Rush

`examples/soaprush/` มีรายการทั้ง 71 รายการ (Game Pass 16 + Developer Product 55) ทุกตัวราคา 999 และเปิดขาย

ไอคอนใช้รูปชุดเดียวกับในร้าน Robux ของเกม (Free Icon Pack v3.1, 1st Outline 256px) ตั้งค่าด้วยคำสั่งนี้:
```bash
node examples/soaprush/pack-icons.js        # สร้าง icon-updates.*.json
node bin/rsc.js game-passes bulk-update examples/soaprush/icon-updates.game-passes.json
node bin/rsc.js developer-products bulk-update examples/soaprush/icon-updates.developer-products.json
```

```bash
node bin/rsc.js game-passes bulk-create examples/soaprush/game-passes.json --dry-run
node bin/rsc.js game-passes bulk-create examples/soaprush/game-passes.json
node bin/rsc.js developer-products bulk-create examples/soaprush/developer-products.json
```
