// =============================================================================
// Object CRUD Tools
// Create, read, update, delete, find, and list objects in a Rool space.
// =============================================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Environment } from '../client.js';
import { getClient } from '../client.js';
import { resolveSpace, jsonResult, textResult, withErrorHandling } from '../utils.js';

const envParam = z.enum(['local', 'dev', 'prod']).optional()
  .describe('Environment to target: "local", "dev", or "prod". Default: dev.');

export function registerObjectTools(server: McpServer): void {
  // ─── Get Object ──────────────────────────────────────────────────────
  server.tool(
    'rool_get_object',
    'Get an object by ID from a Rool space.',
    {
      space: z.string().describe('Space name'),
      object_id: z.string().describe('The object ID to retrieve'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, object_id, environment }: { space: string; object_id: string; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      const obj = await space.getObject(object_id);

      if (!obj) {
        return textResult(`Object not found: "${object_id}"`);
      }

      return jsonResult(obj);
    }),
  );

  // ─── Create Object ──────────────────────────────────────────────────
  server.tool(
    'rool_create_object',
    'Create a new object in a Rool space. Use {{placeholder}} in field values for AI-generated content. Fields prefixed with _ are hidden from AI.',
    {
      space: z.string().describe('Space name'),
      data: z.record(z.string(), z.unknown()).describe('Object data fields. Include "id" for a custom ID, or one will be generated.'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, data, environment }: { space: string; data: Record<string, unknown>; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      const result = await space.createObject({ data });

      return jsonResult({
        object: result.object,
        message: result.message,
      });
    }),
  );

  // ─── Update Object ──────────────────────────────────────────────────
  server.tool(
    'rool_update_object',
    'Update an existing object. Pass data fields to update (null to delete a field), or a prompt for AI-driven editing. Use {{placeholder}} for AI-generated content.',
    {
      space: z.string().describe('Space name'),
      object_id: z.string().describe('ID of the object to update'),
      data: z.record(z.string(), z.unknown()).optional().describe('Fields to add/update. Pass null to delete a field.'),
      prompt: z.string().optional().describe('Natural language instruction for AI to modify the object'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, object_id, data, prompt, environment }: { space: string; object_id: string; data?: Record<string, unknown>; prompt?: string; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      const result = await space.updateObject(object_id, { data, prompt });

      return jsonResult({
        object: result.object,
        message: result.message,
      });
    }),
  );

  // ─── Delete Objects ──────────────────────────────────────────────────
  server.tool(
    'rool_delete_objects',
    'Delete one or more objects from a Rool space by their IDs.',
    {
      space: z.string().describe('Space name'),
      object_ids: z.array(z.string()).describe('Array of object IDs to delete'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, object_ids, environment }: { space: string; object_ids: string[]; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      await space.deleteObjects(object_ids);
      return textResult(`Deleted ${object_ids.length} object(s).`);
    }),
  );

  // ─── Find Objects ────────────────────────────────────────────────────
  server.tool(
    'rool_find_objects',
    'Find objects using structured filters and/or natural language. "where" provides exact-match filtering. "prompt" enables AI-powered semantic queries (uses credits).',
    {
      space: z.string().describe('Space name'),
      where: z.record(z.string(), z.unknown()).optional().describe('Exact-match field filter, e.g. { "type": "article" }'),
      prompt: z.string().optional().describe('Natural language query (triggers AI evaluation)'),
      limit: z.number().optional().describe('Maximum number of results (structured filtering only)'),
      object_ids: z.array(z.string()).optional().describe('Scope search to specific object IDs'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, where, prompt, limit, object_ids, environment }: { space: string; where?: Record<string, unknown>; prompt?: string; limit?: number; object_ids?: string[]; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      const result = await space.findObjects({
        where,
        prompt,
        limit,
        objectIds: object_ids,
      });

      return jsonResult({
        objects: result.objects,
        message: result.message,
        count: result.objects.length,
      });
    }),
  );

  // ─── List Objects ────────────────────────────────────────────────────
  server.tool(
    'rool_list_objects',
    'List object IDs in a Rool space, sorted by modification time.',
    {
      space: z.string().describe('Space name'),
      limit: z.number().optional().describe('Maximum number of IDs to return'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort order by modification time (default: desc)'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, limit, order, environment }: { space: string; limit?: number; order?: 'asc' | 'desc'; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      const ids = space.getObjectIds({ limit, order });

      return jsonResult({
        object_ids: ids,
        count: ids.length,
      });
    }),
  );
}
