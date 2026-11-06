import { defineMonetizedResource } from './_monetized.js';

// Docs: https://create.roblox.com/docs/cloud/reference/features/game-passes
// Scopes: game-pass:read, game-pass:write
export default defineMonetizedResource({
  key: 'gamePasses',
  cliName: 'game-passes',
  title: 'Game Pass',
  description: 'One-time purchases that give a permanent benefit.',
  basePath: (u) => `/game-passes/v1/universes/${u}/game-passes`,
  listKey: 'gamePasses',
  idField: 'gamePassId',
  iconField: 'iconAssetId',
  readRate: 10,
  writeRate: 5,
});
