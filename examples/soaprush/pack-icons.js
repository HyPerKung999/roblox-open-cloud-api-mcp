// Soap Rush: same pack icons the in-game Robux Shop uses (UI.Icons / ItemArt), matched by pixels
// to "Free Icon Pack v3.1 (Basic)" 1st Outline 256px files. Writes icon-updates.<kind>.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '../..');
const PACK = process.env.SOAPRUSH_ICON_PACK || 'G:/My Drive/BUSINESS/Zevio Studios/Soap Rush/Image/Icon/Free Icon Pack v3.1 (Basic)';
const FILE = {
  Cash: 'Currency/Cash/256px/Green Cash 1st Outline 256px.png', Arm: 'Player/Arm/256px/Arm 1st Outline 256px.png',
  Target: 'Item/Target/256px/Target 1st Outline 256px.png', Lightning: 'Main/Lighting/256px/Lighting 1st Outline 256px.png',
  Backpack: 'Item/Backpack/256px/Backpack 1st Outline 256px.png', Potion: 'Item/Potion/256px/Purple Potion 1st Outline 256px.png',
  Rebirth: 'Main/Rebirth and Auto Open/256px/Rebirth 1st Outline 256px.png', Aura: 'Exclusive/Aura/256px/Aura 1st Outline 256px.png',
  Clover: 'Nature/Clover/256px/Clover 1st Outline 256px.png', Shield: 'Item/Shield/256px/Shield 1st Outline 256px.png',
  Medal: 'Item/Medal/256px/Bronze Medal 1st Outline 256px.png', Gift: 'Item/Gift/256px/Green Gift 1st Outline 256px.png',
};
const BY_NAME = {
  'Infinity Backpack': 'Backpack', 'Auto Rebirth': 'Rebirth', 'Auto Sell': 'Cash', 'x1.5 Artifact Money': 'Cash',
  'x2 Finish Diamonds': 'Medal', 'Obstacle Protection': 'Shield', 'Plunger Range +50%': 'Target',
  '+1 Aura Slot': 'Aura', 'x2 Lucky Spin': 'Clover', 'Fast Spin': 'Lightning', // in-game these fall back to Star
  'Money Boost': 'Cash', 'Strength Boost': 'Arm', 'Starter Pack': 'Gift', 'Boost Bundle': 'Potion', 'Skip Rebirth': 'Rebirth',
};
const keyFor = (name) => {
  const n = name.replace(/^Gift /, '');
  if (BY_NAME[n]) return BY_NAME[n];
  if (/^Training x\d+$/.test(n) || /^Strength (Pack|Gain)/.test(n)) return 'Arm';
  if (/^\d+ Aura Spins?$/.test(n)) return 'Aura';
  if (/^Money Multiplier/.test(n)) return 'Cash';
  return null;
};
for (const kind of ['game-passes', 'developer-products']) {
  const items = JSON.parse(fs.readFileSync(path.join(root, `exports/soaprush-${kind}.json`), 'utf8')).filter((x) => !/ Test$/.test(x.name));
  const updates = []; const none = [];
  for (const it of items) {
    const k = keyFor(it.name);
    if (!k) { none.push(it.name); continue; }
    const file = path.join(PACK, FILE[k]);
    if (!fs.existsSync(file)) throw new Error('missing ' + file);
    updates.push({ id: it.id, iconPath: file, _name: it.name, _icon: k });
  }
  fs.writeFileSync(path.join(here, `icon-updates.${kind}.json`), JSON.stringify(updates, null, 2));
  console.log(kind, updates.length, 'icons', none.length ? 'NO ICON: ' + none.join(', ') : '');
}
