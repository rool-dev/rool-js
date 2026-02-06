import * as fs from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';
import { parseArgs } from './args.js';
import { getClient } from './client.js';
import { formatBytes } from './format.js';

function printUsage(): void {
  console.error('Usage: rool publish <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  <app-id> <path>      Publish a directory as an app');
  console.error('  list                 List published apps');
  console.error('  unpublish <app-id>   Unpublish an app');
  console.error('  slug [new-slug]      Show or set your user slug');
  console.error('');
  console.error('Options:');
  console.error('  -n, --name <name>    App display name (defaults to app-id)');
  console.error('  --no-spa             Disable SPA routing (404s won\'t serve index.html)');
  console.error('  -u, --url <url>      API URL (default: https://api.rool.dev)');
  console.error('');
  console.error('Examples:');
  console.error('  rool publish my-app ./dist');
  console.error('  rool publish my-app ./dist -n "My App"');
  console.error('  rool publish list');
  console.error('  rool publish unpublish my-app');
}

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

async function publishApp(
  apiUrl: string,
  appId: string,
  dirPath: string,
  name: string,
  spa: boolean
): Promise<void> {
  // Validate directory exists
  const resolvedPath = path.resolve(dirPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${resolvedPath}`);
    process.exit(1);
  }

  // Check for index.html
  const indexPath = path.join(resolvedPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error(`No index.html found in ${resolvedPath}`);
    console.error('The directory must contain an index.html file at the root.');
    process.exit(1);
  }

  console.log(`Packaging ${resolvedPath}...`);
  const zipBuffer = await zipDirectory(resolvedPath);
  console.log(`Bundle size: ${formatBytes(zipBuffer.length)}`);

  const client = await getClient(apiUrl);
  try {
    console.log(`Publishing ${appId}...`);
    const blob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
    const result = await client.publishApp(appId, { name, bundle: blob, spa });

    console.log('');
    console.log(`Published: ${result.name}`);
    console.log(`URL: ${result.url}`);
    console.log(`Size: ${formatBytes(result.sizeBytes)}`);
    console.log(`SPA routing: ${result.spa ? 'enabled' : 'disabled'}`);
  } finally {
    client.destroy();
  }
}

async function listApps(apiUrl: string): Promise<void> {
  const client = await getClient(apiUrl);
  try {
    const apps = await client.listApps();

    if (apps.length === 0) {
      console.log('No published apps.');
    } else {
      console.log('Published apps:');
      console.log('');
      for (const app of apps) {
        console.log(`  ${app.appId}`);
        console.log(`    Name: ${app.name}`);
        console.log(`    URL: ${app.url}`);
        console.log(`    Size: ${formatBytes(app.sizeBytes)}`);
        console.log(`    SPA: ${app.spa ? 'yes' : 'no'}`);
        console.log(`    Updated: ${new Date(app.updatedAt).toLocaleString()}`);
        console.log('');
      }
    }
  } finally {
    client.destroy();
  }
}

async function unpublishApp(apiUrl: string, appId: string): Promise<void> {
  const client = await getClient(apiUrl);
  try {
    // Check if app exists
    const app = await client.getAppInfo(appId);
    if (!app) {
      console.error(`App not found: ${appId}`);
      process.exit(1);
    }

    await client.unpublishApp(appId);
    console.log(`Unpublished: ${appId}`);
  } finally {
    client.destroy();
  }
}

async function showOrSetSlug(apiUrl: string, newSlug?: string): Promise<void> {
  const client = await getClient(apiUrl);
  try {
    const user = await client.getCurrentUser();

    if (newSlug) {
      await client.setSlug(newSlug);
      console.log(`Slug updated to: ${newSlug}`);
    } else {
      console.log(`Your slug: ${user.slug}`);
    }
  } finally {
    client.destroy();
  }
}

export async function publish(args: string[]): Promise<void> {
  const { url: apiUrl, rest } = parseArgs(args);
  const [subcommand, ...subargs] = rest;

  // Parse additional flags from subargs
  let name: string | undefined;
  let spa = true;
  const positional: string[] = [];

  for (let i = 0; i < subargs.length; i++) {
    const arg = subargs[i];
    if (arg === '-n' || arg === '--name') {
      name = subargs[++i];
      if (!name) {
        console.error('Missing value for --name');
        process.exit(1);
      }
    } else if (arg === '--no-spa') {
      spa = false;
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  switch (subcommand) {
    case 'list':
      await listApps(apiUrl);
      break;

    case 'unpublish': {
      const appId = positional[0];
      if (!appId) {
        console.error('Usage: rool publish unpublish <app-id>');
        process.exit(1);
      }
      await unpublishApp(apiUrl, appId);
      break;
    }

    case 'slug': {
      const newSlug = positional[0];
      await showOrSetSlug(apiUrl, newSlug);
      break;
    }

    case undefined:
      printUsage();
      process.exit(1);
      break;

    default: {
      // Treat as: rool publish <app-id> <path>
      const appId = subcommand;
      const dirPath = positional[0];

      if (!dirPath) {
        console.error('Usage: rool publish <app-id> <path>');
        process.exit(1);
      }

      await publishApp(apiUrl, appId, dirPath, name ?? appId, spa);
      break;
    }
  }
}
