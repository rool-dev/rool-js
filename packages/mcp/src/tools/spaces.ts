// =============================================================================
// Space Management Tools
// List, create, and delete Rool spaces.
// =============================================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient } from '../client.js';
import { evictSpaceByName, jsonResult, textResult, withErrorHandling } from '../utils.js';

export function registerSpaceTools(server: McpServer): void {
  // ─── List Spaces ─────────────────────────────────────────────────────
  server.tool(
    'rool_list_spaces',
    'List all Rool spaces accessible to the authenticated user.',
    {},
    withErrorHandling(async () => {
      const client = await getClient();
      const spaces = await client.listSpaces();

      if (spaces.length === 0) {
        return textResult('No spaces found.');
      }

      const list = spaces.map(s => ({
        id: s.id,
        name: s.name,
        role: s.role,
      }));

      return jsonResult(list);
    }),
  );

  // ─── Create Space ────────────────────────────────────────────────────
  server.tool(
    'rool_create_space',
    'Create a new Rool space.',
    {
      name: z.string().describe('Name for the new space'),
    },
    withErrorHandling(async ({ name }) => {
      const client = await getClient();
      const space = await client.createSpace(name);
      return jsonResult({ id: space.id, name: space.name, role: space.role });
    }),
  );

  // ─── Delete Space ────────────────────────────────────────────────────
  server.tool(
    'rool_delete_space',
    'Delete a Rool space by name. This cannot be undone.',
    {
      name: z.string().describe('Name of the space to delete'),
    },
    withErrorHandling(async ({ name }) => {
      const client = await getClient();
      const spaces = await client.listSpaces();
      const info = spaces.find(s => s.name === name);

      if (!info) {
        return textResult(`Space not found: "${name}"`);
      }

      await client.deleteSpace(info.id);
      evictSpaceByName(name);
      return textResult(`Deleted space: "${name}"`);
    }),
  );
}
