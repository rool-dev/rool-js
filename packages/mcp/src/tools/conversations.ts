// =============================================================================
// Conversation Management Tools
// List, rename, and delete conversations (channels) within a Rool space.
// =============================================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RoolSpaceInfo } from '../types.js';
import type { Environment } from '../client.js';
import { getClient } from '../client.js';
import { jsonResult, textResult, withErrorHandling } from '../utils.js';

const envParam = z.enum(['local', 'dev', 'prod']).optional()
  .describe('Environment to target: "local", "dev", or "prod". Default: dev.');

export function registerConversationTools(server: McpServer): void {
  // ─── List Conversations ──────────────────────────────────────────────
  server.tool(
    'rool_list_conversations',
    'List all conversations in a Rool space with summary info.',
    {
      space: z.string().describe('Space name'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, environment }: { space: string; environment?: Environment }) => {
      const client = await getClient(environment);
      const spaces = await client.listSpaces();
      const info = spaces.find((s: RoolSpaceInfo) => s.name === spaceName);

      if (!info) {
        return textResult(`Space not found: "${spaceName}"`);
      }

      const space = await client.openSpace(info.id);
      const channels = space.getChannels();

      if (channels.length === 0) {
        return textResult('No conversations found.');
      }

      return jsonResult(channels);
    }),
  );

  // ─── Rename Conversation ─────────────────────────────────────────────
  server.tool(
    'rool_rename_conversation',
    'Rename a conversation in a Rool space. Creates the conversation if it does not exist.',
    {
      space: z.string().describe('Space name'),
      conversation_id: z.string().describe('ID of the conversation to rename'),
      name: z.string().describe('New name for the conversation'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, conversation_id, name, environment }: { space: string; conversation_id: string; name: string; environment?: Environment }) => {
      const client = await getClient(environment);
      const spaces = await client.listSpaces();
      const info = spaces.find((s: RoolSpaceInfo) => s.name === spaceName);

      if (!info) {
        return textResult(`Space not found: "${spaceName}"`);
      }

      await client.renameChannel(info.id, conversation_id, name);
      return textResult(`Conversation "${conversation_id}" renamed to "${name}".`);
    }),
  );

  // ─── Delete Conversation ─────────────────────────────────────────────
  server.tool(
    'rool_delete_conversation',
    'Delete a conversation and its interaction history from a Rool space.',
    {
      space: z.string().describe('Space name'),
      conversation_id: z.string().optional().describe('ID of the conversation to delete (defaults to current "mcp" conversation)'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, conversation_id, environment }: { space: string; conversation_id?: string; environment?: Environment }) => {
      const client = await getClient(environment);
      const spaces = await client.listSpaces();
      const info = spaces.find((s: RoolSpaceInfo) => s.name === spaceName);

      if (!info) {
        return textResult(`Space not found: "${spaceName}"`);
      }

      await client.deleteChannel(info.id, conversation_id ?? 'mcp');
      return textResult(`Conversation deleted.`);
    }),
  );
}
