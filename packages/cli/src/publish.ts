import * as fs from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { formatBytes } from './format.js';
import { DEFAULT_API_URL } from './constants.js';

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

export function registerPublish(program: Command): void {
  const publish = program
    .command('publish')
    .description('Publish and manage apps');

  publish
    .command('deploy')
    .description('Publish a directory as an app')
    .argument('<app-id>', 'unique app identifier')
    .argument('<path>', 'directory to publish')
    .option('-n, --name <name>', 'app display name (defaults to app-id)')
    .option('--no-spa', 'disable SPA routing (404s will not serve index.html)')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (appId: string, dirPath: string, opts: { name?: string; spa: boolean; url: string }) => {
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

      const client = await getClient(opts.url);
      try {
        console.log(`Publishing ${appId}...`);
        const blob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
        const result = await client.publishApp(appId, { name: opts.name ?? appId, bundle: blob, spa: opts.spa });

        console.log('');
        console.log(`Published: ${result.name}`);
        console.log(`URL: ${result.url}`);
        console.log(`Size: ${formatBytes(result.sizeBytes)}`);
        console.log(`SPA routing: ${result.spa ? 'enabled' : 'disabled'}`);
      } finally {
        client.destroy();
      }
    });

  publish
    .command('list')
    .description('List published apps')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (opts: { url: string }) => {
      const client = await getClient(opts.url);
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
    });

  publish
    .command('unpublish')
    .description('Unpublish an app')
    .argument('<app-id>', 'app to unpublish')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (appId: string, opts: { url: string }) => {
      const client = await getClient(opts.url);
      try {
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
    });

  publish
    .command('slug')
    .description('Show or set your user slug')
    .argument('[new-slug]', 'new slug to set')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (newSlug: string | undefined, opts: { url: string }) => {
      const client = await getClient(opts.url);
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
    });
}
