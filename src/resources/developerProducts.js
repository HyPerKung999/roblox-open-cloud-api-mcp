import { defineMonetizedResource } from './_monetized.js';

// Docs: https://create.roblox.com/docs/cloud/reference/features/developer-products
// Scopes: developer-product:read, developer-product:write
export default defineMonetizedResource({
  key: 'developerProducts',
  cliName: 'developer-products',
  title: 'Developer Product',
  description: 'Repeatable purchases (currency, boosts, spins...).',
  basePath: (u) => `/developer-products/v2/universes/${u}/developer-products`,
  listKey: 'developerProducts',
  idField: 'productId',
  iconField: 'iconImageAssetId',
  readRate: 10,
  writeRate: 3,
  extraUpdateFields: {
    storePageEnabled: { type: 'boolean', update: true, description: 'Sell on the external store page (update only).' },
  },
});
