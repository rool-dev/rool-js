// =============================================================================
// Chat / Prompt Tool
// Send a prompt to a Rool space and get an AI response.
// =============================================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Environment } from '../client.js';
import { getClient } from '../client.js';
import { resolveSpace, textResult, withErrorHandling } from '../utils.js';

const envParam = z.enum(['local', 'dev', 'prod']).optional()
  .describe('Environment to target: "local", "dev", or "prod". Default: dev.');

export function registerChatTools(server: McpServer): void {
  server.tool(
    'rool_chat',
    'Send a prompt to a Rool space and get an AI response. The space acts as a persistent context with objects, conversations, and media.',
    {
      space: z.string().describe('Name of the Rool space to chat with'),
      prompt: z.string().describe('The prompt/message to send'),
      conversation_id: z.string().optional().describe('Conversation ID for context continuity (default: "mcp")'),
      effort: z.enum(['QUICK', 'STANDARD', 'REASONING', 'RESEARCH']).optional()
        .describe('AI effort level. QUICK=fast read-only, STANDARD=default, REASONING=extended thinking'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, prompt, conversation_id, effort, environment }: { space: string; prompt: string; conversation_id?: string; effort?: 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH'; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, conversation_id, environment);
      const result = await space.prompt(prompt, { effort });

      let text = result.message;
      if (result.objects.length > 0) {
        text += `\n\n---\nModified objects (${result.objects.length}):\n`;
        for (const obj of result.objects) {
          text += `\n${JSON.stringify(obj, null, 2)}`;
        }
      }

      return textResult(text);
    }),
  );
}
