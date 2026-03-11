// =============================================================================
// App Publishing Tools
// Publish, list, and unpublish Rool apps.
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient } from '../client.js';
import { jsonResult, textResult, withErrorHandling } from '../utils.js';

export function registerAppTools(server: McpServer): void {
  // ─── List Apps ───────────────────────────────────────────────────────
  server.tool(
    'rool_list_apps',
    'List all published Rool apps for the authenticated user.',
    {},
    withErrorHandling(async () => {
      const client = await getClient();
      const apps = await client.listApps();

      if (apps.length === 0) {
        return textResult('No published apps.');
      }

      return jsonResult(apps);
    }),
  );

  // ─── Publish App ─────────────────────────────────────────────────────
  server.tool(
    'rool_publish_app',
    'Publish a directory as a Rool app. The directory must contain an index.html at the root. The app will be accessible at https://{app_id}.rool.app/.',
    {
      app_id: z.string().describe('URL-safe app identifier (alphanumeric, hyphens, underscores)'),
      dir_path: z.string().describe('Absolute path to the directory to publish'),
      name: z.string().optional().describe('Display name for the app (defaults to app_id)'),
    },
    withErrorHandling(async ({ app_id, dir_path, name }) => {
      const resolvedPath = path.resolve(dir_path);

      if (!fs.existsSync(resolvedPath)) {
        return textResult(`Directory not found: ${resolvedPath}`);
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        return textResult(`Not a directory: ${resolvedPath}`);
      }

      const indexPath = path.join(resolvedPath, 'index.html');
      if (!fs.existsSync(indexPath)) {
        return textResult(`No index.html found in ${resolvedPath}. The directory must contain an index.html file at the root.`);
      }

      const zipBuffer = await zipDirectory(resolvedPath);
      const blob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });

      const client = await getClient();
      const result = await client.publishApp(app_id.toLowerCase(), {
        name: name ?? app_id,
        bundle: blob,
      });

      return jsonResult({
        appId: result.appId,
        name: result.name,
        url: result.url,
        sizeBytes: result.sizeBytes,
        spa: result.spa,
      });
    }),
  );

  // ─── Unpublish App ───────────────────────────────────────────────────
  server.tool(
    'rool_unpublish_app',
    'Unpublish a Rool app by its ID.',
    {
      app_id: z.string().describe('App identifier to unpublish'),
    },
    withErrorHandling(async ({ app_id }) => {
      const client = await getClient();
      const info = await client.getAppInfo(app_id.toLowerCase());

      if (!info) {
        return textResult(`App not found: ${app_id}`);
      }

      await client.unpublishApp(app_id.toLowerCase());
      return textResult(`Unpublished: ${app_id}`);
    }),
  );
}

// =============================================================================
// Helpers
// =============================================================================

async function zipDirectory(dirPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.directory(dirPath, false);
    archive.finalize();
  });
}
