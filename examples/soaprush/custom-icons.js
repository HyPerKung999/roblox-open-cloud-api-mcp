// Soap Rush custom icons (2026-11-07): the owner's own pictures in Image\Icon, matched by file name to the item
// name on Roblox. "Gamepass\<name>.png" sets the pass and its "Gift <name>" product; "Developer Products\Aura
// Spin.png" sets every "... Aura Spin(s)" product. Writes custom-icons.<kind>.json for bulk-update and lists what
// still has no picture.
//   node examples/soaprush/custom-icons.js
//   node bin/rsc.js game-passes bulk-update examples/soaprush/custom-icons.game-passes.json
//   node bin/rsc.js developer-products bulk-update examples/soaprush/custom-icons.developer-products.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SOAPRUSH_CUSTOM_ICONS || 'G:/My Drive/BUSINESS/Zevio Studios/Soap Rush/Image/Icon';
const exportsDir = path.join(here, '..', '..', 'exports');

const pngs = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => ({ name: f.replace(/\.(png|jpe?g)$/i, ''), file: path.join(dir, f) }))
  : [];
const passPics = pngs(path.join(ROOT, 'Gamepass'));
const productPics = pngs(path.join(ROOT, 'Developer Products'));

// the picture for one item name, or undefined
function pictureFor(kind, name) {
  if (kind === 'game-passes') return passPics.find((p) => p.name.toLowerCase() === name.toLowerCase())?.file;
  const gift = name.startsWith('Gift ') ? name.slice(5) : null;
  const pass = gift && passPics.find((p) => p.name.toLowerCase() === gift.toLowerCase());
  if (pass) return pass.file;
  const base = gift || name;
  const exact = productPics.find((p) => p.name.toLowerCase() === base.toLowerCase());
  if (exact) return exact.file;
  if (/^\d+ Aura Spins?$/.test(base)) return productPics.find((p) => p.name === 'Aura Spin')?.file;
  return undefined;
}

for (const kind of ['game-passes', 'developer-products']) {
  const items = JSON.parse(fs.readFileSync(path.join(exportsDir, `soaprush-${kind}.json`), 'utf8'))
    .filter((it) => !/Test$/.test(it.name));
  const updates = [];
  const missing = [];
  for (const it of items) {
    const file = pictureFor(kind, it.name);
    if (file) updates.push({ id: it.id, iconPath: file, _name: it.name });
    else missing.push(it.name);
  }
  fs.writeFileSync(path.join(here, `custom-icons.${kind}.json`), JSON.stringify(updates, null, 2));
  console.log(`${kind}: ${updates.length} with a picture, ${missing.length} without`);
  console.log('  set:', updates.map((u) => `${u._name} <- ${path.basename(u.iconPath)}`).join(' | '));
  console.log('  no picture:', missing.join(', '));
}
