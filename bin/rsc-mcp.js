#!/usr/bin/env node
import { startStdioServer } from '../src/mcp/server.js';

startStdioServer().catch((err) => {
  // stdout is the MCP channel, so errors go to stderr only.
  console.error(`[roblox-studio-connect] ${err.message}`);
  process.exit(1);
});
