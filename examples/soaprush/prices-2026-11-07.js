// Soap Rush price table agreed with the owner on 2026-11-07. Matches the live items by exact name and writes
// prices-2026-11-07.<kind>.json for bulk-update. "Gift X" costs the same as X. Lists anything without a price.
//   node examples/soaprush/prices-2026-11-07.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRobloxConnect } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const PRICES = {
  // Game Passes
  'Training x25': 249, 'Training x35': 399, 'Training x50': 599, 'Training x100': 999, 'Training x500': 1999, 'Training x1000': 3999,
  'Infinity Backpack': 299, 'Auto Rebirth': 199, 'Auto Sell': 149, 'x1.5 Artifact Money': 199, 'x2 Finish Diamonds': 249,
  'Obstacle Protection': 179, 'Plunger Range +50%': 199, 'x2 Lucky Spin': 249, 'Fast Spin': 149,
  // Developer Products
  '+1 Aura Slot': 179, 'Skip Rebirth': 199, 'Starter Pack': 99, 'Boost Bundle': 129, 'Money Boost': 39, 'Strength Boost': 39,
  '1 Aura Spin': 29, '25 Aura Spins': 649, '50 Aura Spins': 1199, '100 Aura Spins': 2199,
  'Strength Pack S10K': 19, 'Strength Pack S50K': 89, 'Strength Pack S100K': 169, 'Strength Pack S500K': 799, 'Strength Pack S1M': 1499,
  'Diamond Pack D100': 29, 'Diamond Pack D500': 129, 'Diamond Pack D1000': 249, 'Diamond Pack D2500': 599, 'Diamond Pack D5000': 1099,
};
const TIERS = { 2: 9, 4: 29, 8: 49, 16: 99, 32: 199, 64: 399, 128: 799, 256: 1499 };
for (const [m, p] of Object.entries(TIERS)) {
  PRICES[`Money Multiplier x${m}`] = p;
  PRICES[`Strength Gain x${m}`] = p;
}

// the old +1 Aura Slot pass is no longer sold in game; its price is left alone
const SKIP = new Set(['Gamepass Test', 'Developer Product Test']);

function priceFor(kind, name) {
  if (kind === 'game-passes' && name === '+1 Aura Slot') return undefined; // legacy pass
  if (PRICES[name] !== undefined) return PRICES[name];
  if (name.startsWith('Gift ')) return PRICES[name.slice(5)];
  return undefined;
}

const rc = createRobloxConnect();
for (const [kind, res] of [['game-passes', 'gamePasses'], ['developer-products', 'developerProducts']]) {
  const live = await rc[res].list();
  const updates = [];
  const missing = [];
  for (const it of live) {
    if (SKIP.has(it.name)) continue;
    const price = priceFor(kind, it.name);
    if (price === undefined) missing.push(it.name);
    else if (it.price !== price) updates.push({ id: it.id, price, _name: it.name, _was: it.price });
  }
  fs.writeFileSync(path.join(here, `prices-2026-11-07.${kind}.json`), JSON.stringify(updates, null, 2));
  console.log(`${kind}: ${updates.length} to change, ${live.length} live; no price: ${missing.join(', ') || 'none'}`);
}
