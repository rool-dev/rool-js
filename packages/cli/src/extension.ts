import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { formatBytes } from './format.js';
import { type Environment } from './constants.js';

/**
 * Spawn a rool-extension CLI command, forwarding the --env flag.
 */
function spawnRoolExtension(command: string, args: string[], env: Environment): void {
  const require = createRequire(import.meta.url);
  const extensionPkg = require.resolve('@rool-dev/extension/package.json');
  const bin = resolve(dirname(extensionPkg), 'dist/cli/index.js');

  const fullArgs = [command, ...args];
  if (env !== 'prod') {
    fullArgs.push('--env', env);
  }

  const result = spawnSync(process.execPath, [bin, ...fullArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  process.exit(result.status ?? 1);
}

export function registerExtension(program: Command): void {
  const ext = program
    .command('extension')
    .description('Create, develop, build, publish, and manage extensions');

  ext
    .command('create')
    .description('Create a new Rool extension')
    .argument('[name]', 'extension name (creates subdirectory)')
    .action((name: string | undefined, _opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolExtension('init', name ? [name] : [], env);
    });

  ext
    .command('dev')
    .description('Start the dev server')
    .action((_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolExtension('dev', [], env);
    });

  ext
    .command('build')
    .description('Build the extension')
    .action((_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolExtension('build', [], env);
    });

  ext
    .command('publish')
    .description('Build and publish the extension')
    .action((_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolExtension('publish', [], env);
    });

  ext
    .command('list')
    .description('List published extensions')
    .action(async (_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
      try {
        const extensions = await client.listExtensions();

        if (extensions.length === 0) {
          console.log('No published extensions.');
        } else {
          console.log('Published extensions:');
          console.log('');
          for (const a of extensions) {
            console.log(`  ${a.extensionId}`);
            console.log(`    Name: ${a.manifest.name}`);
            console.log(`    URL: ${a.url}`);
            console.log(`    Size: ${formatBytes(a.sizeBytes)}`);
            console.log(`    Updated: ${new Date(a.updatedAt).toLocaleString()}`);
            console.log('');
          }
        }
      } finally {
        client.destroy();
      }
    });

  ext
    .command('unpublish')
    .description('Unpublish an extension')
    .argument('<extension-id>', 'extension to unpublish')
    .action(async (rawExtensionId: string, _opts: object, command: Command) => {
      const extensionId = rawExtensionId.toLowerCase();
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
      try {
        const a = await client.getExtensionInfo(extensionId);
        if (!a) {
          console.error(`Extension not found: ${extensionId}`);
          process.exit(1);
        }

        await client.unpublishExtension(extensionId);
        console.log(`Unpublished: ${extensionId}`);
      } finally {
        client.destroy();
      }
    });

  ext
    .command('slug')
    .description('Show or set your user slug')
    .argument('[new-slug]', 'new slug to set')
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
