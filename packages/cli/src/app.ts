import * as fs from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { formatBytes } from './format.js';
import { type Environment } from './constants.js';

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

export function registerApp(program: Command): void {
  const app = program
    .command('app')
    .description('Publish and manage apps');

  app
    .command('publish')
    .description('Publish a directory as an app')
    .argument('<app-id>', 'unique app identifier')
    .argument('<path>', 'directory to publish')
    .option('-n, --name <name>', 'app display name (defaults to app-id)')
    .option('--no-spa', 'disable SPA routing (404s will not serve index.html)')
    .addHelpText('after', `
Examples:
  # Publish a directory as an app
  $ rool app publish my-app ./dist

  # Publish with a custom name
  $ rool app publish my-app ./dist -n "My App"`)
    .action(async (appId: string, dirPath: string, opts: { name?: string; spa: boolean }, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
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

      const client = await getClient(env);
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

  app
    .command('list')
    .description('List published apps')
    .addHelpText('after', `
Examples:
  # List published apps
  $ rool app list`)
    .action(async (_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
      try {
        const apps = await client.listApps();

        if (apps.length === 0) {
          console.log('No published apps.');
        } else {
          console.log('Published apps:');
          console.log('');
          for (const a of apps) {
            console.log(`  ${a.appId}`);
            console.log(`    Name: ${a.name}`);
            console.log(`    URL: ${a.url}`);
            console.log(`    Size: ${formatBytes(a.sizeBytes)}`);
            console.log(`    SPA: ${a.spa ? 'yes' : 'no'}`);
            console.log(`    Updated: ${new Date(a.updatedAt).toLocaleString()}`);
            console.log('');
          }
        }
      } finally {
        client.destroy();
      }
    });

  app
    .command('unpublish')
    .description('Unpublish an app')
    .argument('<app-id>', 'app to unpublish')
    .addHelpText('after', `
Examples:
  # Unpublish an app
  $ rool app unpublish my-app`)
    .action(async (appId: string, _opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
      try {
        const a = await client.getAppInfo(appId);
        if (!a) {
          console.error(`App not found: ${appId}`);
          process.exit(1);
        }

        await client.unpublishApp(appId);
        console.log(`Unpublished: ${appId}`);
      } finally {
        client.destroy();
      }
    });

  app
    .command('slug')
    .description('Show or set your user slug')
    .argument('[new-slug]', 'new slug to set')
    .addHelpText('after', `
Examples:
  # Show your user slug
  $ rool app slug

  # Set your user slug
  $ rool app slug my-slug`)
    .action(async (newSlug: string | undefined, _opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
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
