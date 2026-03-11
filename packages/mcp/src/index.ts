#!/usr/bin/env node
// =============================================================================
// Rool MCP Server
// Exposes the Rool platform (spaces, chat, objects, media, apps) as MCP tools.
// Uses stdio transport for compatibility with Claude Code and other MCP clients.
// =============================================================================

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { destroyClient } from './client.js';
import { closeAllSpaces } from './utils.js';
import { registerChatTools } from './tools/chat.js';
import { registerSpaceTools } from './tools/spaces.js';
import { registerObjectTools } from './tools/objects.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerMediaTools } from './tools/media.js';
import { registerAppTools } from './tools/apps.js';
import { registerSchemaTools } from './tools/schema.js';

// =============================================================================
// Server Setup
// =============================================================================

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const server = new McpServer(
  {
    name: 'rool-mcp',
    version: pkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Register all tools
registerChatTools(server);
registerSpaceTools(server);
registerObjectTools(server);
registerConversationTools(server);
registerMediaTools(server);
registerAppTools(server);
registerSchemaTools(server);

// =============================================================================
// Lifecycle
// =============================================================================

function cleanup(): void {
  closeAllSpaces();
  destroyClient();
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// =============================================================================
// Start
// =============================================================================

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Rool MCP: ${err}\n`);
  process.exit(1);
});
