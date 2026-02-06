import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { formatBytes } from './format.js';
import { DEFAULT_API_URL, DEFAULT_SPACE_NAME } from './constants.js';

function getContentType(filePath: string): string {
  try {
    return execSync(`file --mime-type -b "${filePath}"`, { encoding: 'utf-8' }).trim();
  } catch {
    return 'application/octet-stream';
  }
}

export function registerMedia(program: Command): void {
  const media = program
    .command('media')
    .description('Manage media files');

  media
    .command('upload')
    .description('Upload a file to a space and create an object with the media URL')
    .argument('<file>', 'file to upload')
    .option('-m, --message <text>', 'optional comment/description')
    .option('-s, --space <name>', 'space name', DEFAULT_SPACE_NAME)
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (filePath: string, opts: { message?: string; space: string; url: string }) => {
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        console.error(`Not a file: ${filePath}`);
        process.exit(1);
      }

      const filename = path.basename(filePath);
      const contentType = getContentType(filePath);
      const size = stats.size;

      const client = await getClient(opts.url);

      // Find or create space by name
      const spaces = await client.listSpaces();
      const spaceInfo = spaces.find(s => s.name === opts.space);
      const space = spaceInfo
        ? await client.openSpace(spaceInfo.id)
        : await client.createSpace(opts.space);

      try {
        const fileBuffer = fs.readFileSync(filePath);
        const blob = new Blob([fileBuffer], { type: contentType });

        console.log(`Uploading ${filename} (${formatBytes(size)})...`);
        const url = await space.uploadMedia(blob);

        const objectData: Record<string, unknown> = {
          type: 'file',
          url,
          filename,
          contentType,
          size,
          uploadedAt: new Date().toISOString(),
        };

        if (opts.message) {
          objectData.comment = opts.message;
        }

        const { object } = await space.createObject({ data: objectData });

        console.log(`Uploaded: ${filename} (${formatBytes(size)})`);
        console.log(`Created object: ${object.id}`);
        console.log(`URL: ${url}`);
      } finally {
        space.close();
        client.destroy();
      }
    });
}
