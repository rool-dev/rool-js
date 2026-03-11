// =============================================================================
// Schema Tools
// Get, create, alter, and drop collection schemas in a Rool space.
// =============================================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient } from '../client.js';
import { resolveSpace, jsonResult, textResult, withErrorHandling } from '../utils.js';

const fieldTypeSchema: z.ZodType<unknown> = z.union([
  z.object({ kind: z.literal('string') }),
  z.object({ kind: z.literal('number') }),
  z.object({ kind: z.literal('boolean') }),
  z.object({ kind: z.literal('ref') }),
  z.object({ kind: z.literal('array'), inner: z.lazy(() => fieldTypeSchema).optional() }),
  z.object({ kind: z.literal('maybe'), inner: z.lazy(() => fieldTypeSchema) }),
  z.object({ kind: z.literal('enum'), values: z.array(z.string()) }),
  z.object({ kind: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean()]) }),
]);

const fieldDefSchema = z.object({
  name: z.string().describe('Field name'),
  type: fieldTypeSchema.describe('Field type (e.g. { "kind": "string" }, { "kind": "ref" }, { "kind": "array", "inner": { "kind": "string" } })'),
});

export function registerSchemaTools(server: McpServer): void {
  // ─── Get Schema ──────────────────────────────────────────────────────
  server.tool(
    'rool_get_schema',
    'Get the collection schema for a Rool space. Returns all collection definitions with their fields and types.',
    {
      space: z.string().describe('Space name'),
    },
    withErrorHandling(async ({ space: spaceName }) => {
      const client = await getClient();
      const channel = await resolveSpace(client, spaceName);
      const schema = channel.getSchema();

      if (Object.keys(schema).length === 0) {
        return textResult('No collections defined. Use rool_create_collection to define one.');
      }

      return jsonResult(schema);
    }),
  );

  // ─── Create Collection ───────────────────────────────────────────────
  server.tool(
    'rool_create_collection',
    'Create a new collection schema in a Rool space. A collection defines the shape of objects (name and typed fields). Must be created before adding objects of that type.',
    {
      space: z.string().describe('Space name'),
      name: z.string().describe('Collection name (must start with a letter, alphanumeric/hyphens/underscores only)'),
      fields: z.array(fieldDefSchema).describe('Field definitions. Each field has a name and a type like { "kind": "string" }, { "kind": "number" }, { "kind": "boolean" }, { "kind": "ref" } (reference to another object), { "kind": "array" }, { "kind": "maybe", "inner": ... }, { "kind": "enum", "values": [...] }'),
    },
    withErrorHandling(async ({ space: spaceName, name, fields }) => {
      const client = await getClient();
      const channel = await resolveSpace(client, spaceName);
      const collection = await channel.createCollection(name, fields as any);
      return jsonResult({ name, collection });
    }),
  );

  // ─── Alter Collection ────────────────────────────────────────────────
  server.tool(
    'rool_alter_collection',
    'Alter an existing collection schema, replacing all its field definitions.',
    {
      space: z.string().describe('Space name'),
      name: z.string().describe('Name of the collection to alter'),
      fields: z.array(fieldDefSchema).describe('New field definitions (replaces all existing fields)'),
    },
    withErrorHandling(async ({ space: spaceName, name, fields }) => {
      const client = await getClient();
      const channel = await resolveSpace(client, spaceName);
      const collection = await channel.alterCollection(name, fields as any);
      return jsonResult({ name, collection });
    }),
  );

  // ─── Drop Collection ─────────────────────────────────────────────────
  server.tool(
    'rool_drop_collection',
    'Drop a collection schema from a Rool space. Existing objects are not deleted.',
    {
      space: z.string().describe('Space name'),
      name: z.string().describe('Name of the collection to drop'),
    },
    withErrorHandling(async ({ space: spaceName, name }) => {
      const client = await getClient();
      const channel = await resolveSpace(client, spaceName);
      await channel.dropCollection(name);
      return textResult(`Dropped collection: "${name}"`);
    }),
  );
}
