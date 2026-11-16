import gamePasses from './gamePasses.js';
import developerProducts from './developerProducts.js';
import assets from './assets.js';

/**
 * Every resource the toolkit knows. To add a new one later (badges, data
 * stores, places, ...): create src/resources/<name>.js with defineResource()
 * and add it here. The module API, CLI and MCP tools pick it up automatically.
 */
export const builtinResources = [gamePasses, developerProducts, assets];
