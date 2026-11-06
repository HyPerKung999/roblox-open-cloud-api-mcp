/**
 * A "resource" is one kind of Roblox thing we manage (game passes, developer
 * products, later badges, data stores, ...). Each resource file exports a
 * definition made with defineResource(); the registry, the module API, the CLI
 * and the MCP server are all built from these definitions, so adding a new
 * kind means adding one file under src/resources and registering it.
 *
 * A definition:
 * {
 *   key:         'gamePasses'            // JS property name
 *   cliName:     'game-passes'           // CLI / MCP name (kebab)
 *   title:       'Game Pass'
 *   description: 'one line for help text'
 *   fields:      { name: { type, required?, create?, update?, description } }
 *   operations:  { list, get, create, update, ... } // async (ctx, args) => result
 * }
 * ctx = { client, universeId, resource }
 */
export function defineResource(def) {
  for (const k of ['key', 'cliName', 'title', 'operations']) {
    if (!def[k]) throw new Error(`Resource definition missing "${k}"`);
  }
  return Object.freeze({ fields: {}, description: '', ...def });
}

/** Bind a resource definition to a client + universe, giving plain async methods. */
export function bindResource(def, ctxBase) {
  const ctx = { ...ctxBase, resource: def };
  const bound = { definition: def };
  for (const [op, fn] of Object.entries(def.operations)) {
    bound[op] = (args = {}) => fn(ctx, args);
  }
  return bound;
}
