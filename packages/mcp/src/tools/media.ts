// =============================================================================
// Media Tools
// Upload files to and list media in a Rool space.
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Environment } from '../client.js';
import { getClient } from '../client.js';
import { resolveSpace, jsonResult, textResult, withErrorHandling } from '../utils.js';

const envParam = z.enum(['local', 'dev', 'prod']).optional()
  .describe('Environment to target: "local", "dev", or "prod". Default: dev.');

export function registerMediaTools(server: McpServer): void {
  // ─── Upload Media ────────────────────────────────────────────────────
  server.tool(
    'rool_upload_media',
    'Upload a local file to a Rool space. Returns the URL of the uploaded file.',
    {
      space: z.string().describe('Space name'),
      file_path: z.string().describe('Absolute path to the local file to upload'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, file_path, environment }: { space: string; file_path: string; environment?: Environment }) => {
      if (!fs.existsSync(file_path)) {
        return textResult(`File not found: ${file_path}`);
      }

      const stats = fs.statSync(file_path);
      if (!stats.isFile()) {
        return textResult(`Not a file: ${file_path}`);
      }

      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);

      const fileBuffer = fs.readFileSync(file_path);
      const contentType = guessContentType(file_path);
      const blob = new Blob([fileBuffer], { type: contentType });

      const url = await space.uploadMedia(blob);

      return jsonResult({
        url,
        filename: path.basename(file_path),
        contentType,
        size: stats.size,
      });
    }),
  );

  // ─── List Media ──────────────────────────────────────────────────────
  server.tool(
    'rool_list_media',
    'List all media files in a Rool space.',
    {
      space: z.string().describe('Space name'),
      environment: envParam,
    },
    withErrorHandling(async ({ space: spaceName, environment }: { space: string; environment?: Environment }) => {
      const client = await getClient(environment);
      const space = await resolveSpace(client, spaceName, undefined, environment);
      const media = await space.listMedia();

      if (media.length === 0) {
        return textResult('No media files found.');
      }

      return jsonResult(media);
    }),
  );
}

// =============================================================================
// Helpers
// =============================================================================

const EXTENSION_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TYPES[ext] ?? 'application/octet-stream';
}
