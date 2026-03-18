import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { formatBytes } from './format.js';
import { type Environment } from './constants.js';

/**
 * Spawn a rool-app CLI command, forwarding the --env flag.
 */
function spawnRoolApp(command: string, args: string[], env: Environment): void {
  const require = createRequire(import.meta.url);
  const appPkg = require.resolve('@rool-dev/app/package.json');
  const bin = resolve(dirname(appPkg), 'dist/cli/index.js');

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

export function registerApp(program: Command): void {
  const app = program
    .command('app')
    .description('Create, develop, build, publish, and manage apps');

  app
    .command('create')
    .description('Create a new Rool app')
    .argument('[name]', 'app name (creates subdirectory)')
    .action((name: string | undefined, _opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolApp('init', name ? [name] : [], env);
    });

  app
    .command('dev')
    .description('Start the dev server')
    .action((_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolApp('dev', [], env);
    });

  app
    .command('build')
    .description('Build the app')
    .action((_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolApp('build', [], env);
    });

  app
    .command('publish')
    .description('Build and publish the app')
    .action((_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      spawnRoolApp('publish', [], env);
    });

  app
    .command('list')
    .description('List published apps')
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

  app
    .command('unpublish')
    .description('Unpublish an app')
    .argument('<app-id>', 'app to unpublish')
    .action(async (rawAppId: string, _opts: object, command: Command) => {
      const appId = rawAppId.toLowerCase();
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
