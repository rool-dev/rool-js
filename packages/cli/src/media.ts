import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, printCommonOptions } from './args.js';
import { getClient } from './client.js';
import { formatBytes } from './format.js';

function getContentType(filePath: string): string {
  try {
    return execSync(`file --mime-type -b "${filePath}"`, { encoding: 'utf-8' }).trim();
  } catch {
    return 'application/octet-stream';
  }
}

function printUsage(): void {
  console.error('Usage: rool media upload <file> [options]');
  console.error('');
  console.error('Upload a file to a space and create an object with the media URL.');
  console.error('');
  console.error('Options:');
  console.error('  -m, --message <text>   Optional comment/description');
  printCommonOptions();
  console.error('');
  console.error('Examples:');
  console.error('  rool media upload photo.jpg');
  console.error('  rool media upload report.pdf -m "Q4 sales report"');
  console.error('  rool media upload logo.png -s "My Project"');
}

async function uploadMedia(args: string[]): Promise<void> {
  const { space: spaceName, url: apiUrl, message, rest } = parseArgs(args);
  const filePath = rest[0];

  if (!filePath) {
    printUsage();
    process.exit(1);
  }

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

  const client = await getClient(apiUrl);

  // Find or create space by name
  const spaces = await client.listSpaces();
  const spaceInfo = spaces.find(s => s.name === spaceName);
  const space = spaceInfo
    ? await client.openSpace(spaceInfo.id)
    : await client.createSpace(spaceName);

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

    if (message) {
      objectData.comment = message;
    }

    const { object } = await space.createObject({ data: objectData });

    console.log(`Uploaded: ${filename} (${formatBytes(size)})`);
    console.log(`Created object: ${object.id}`);
    console.log(`URL: ${url}`);
  } finally {
    space.close();
    client.destroy();
  }
}

export async function media(args: string[]): Promise<void> {
  const [subcommand, ...subargs] = args;

  if (subcommand === 'upload') {
    await uploadMedia(subargs);
  } else {
    printUsage();
    process.exit(1);
  }
}
