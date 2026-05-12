#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { isAgentMode } from './preview/lib.js';

if (process.env.ROOL_PREVIEW_DAEMON === '1') {
  const { previewDaemon } = await import('./preview/daemon.js');
  await previewDaemon();
  process.exit(0);
}

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const program = new Command();

program
  .name('rool-extension')
  .description('Build, run, and publish Rool extensions.')
  .version(version);

// ---------------------------------------------------------------------------
// Always available — the core build / observe loop. These are the only
// commands a coding agent (ROOL_AGENT_MODE=1) ever sees.
// ---------------------------------------------------------------------------

program
  .command('init [name]')
  .description('Scaffold a new extension project.')
  .action(async (name?: string) => {
    const { init } = await import('./init.js');
    init(name);
  });

program
  .command('build')
  .description('Build the extension into ./dist.')
  .action(async () => {
    const { build } = await import('./build.js');
    await build();
  });

const previewCmd = program
  .command('preview')
  .description(
    'Browser-interaction commands. Subcommands auto-ensure a preview daemon ' +
    'for the extension in cwd; browser sessions are implict without a separate boot step.',
  );

previewCmd
  .command('screenshot')
  .description(
    'Capture a PNG of the loaded preview. Writes to ./screenshots/NNN-screenshot.png ' +
    'where NNN is the current session step (auto-incremented per interaction).',
  )
  .option('--out <path>', 'Override the output path')
  .action(async (opts) => {
    const { screenshot } = await import('./preview/screenshot.js');
    await screenshot(opts);
  });

previewCmd
  .command('reset')
  .description(
    'Start a new preview session: restart the daemon, reset the step counter to 0, ' +
    'and wipe ./screenshots/. Use after `build` to pick up code changes.',
  )
  .action(async () => {
    const { reset } = await import('./preview/reset.js');
    await reset();
  });

// ---------------------------------------------------------------------------
// Human-only commands — upload + library/marketplace management aren't part
// of an agent's build loop.
// ---------------------------------------------------------------------------

if (!isAgentMode()) {
  program
    .command('upload')
    .description('Build and upload the extension to your library. Use --publish to also publish.')
    .option('--env <env>', 'environment (local, dev, prod)', 'prod')
    .option('-p, --publish', 'also publish to the public marketplace', false)
    .action(async (opts: { env: 'local' | 'dev' | 'prod'; publish: boolean }) => {
      const { upload } = await import('./upload.js');
      await upload(opts);
    });

  program
    .command('list')
    .description('List the extensions in your library.')
    .option('--env <env>', 'environment (local, dev, prod)', 'prod')
    .action(async (opts: { env: 'local' | 'dev' | 'prod' }) => {
      const { list } = await import('./list.js');
      await list(opts.env);
    });

  program
    .command('delete')
    .description('Permanently delete an extension from your library.')
    .argument('<extension-id>', 'extension to delete')
    .option('--env <env>', 'environment (local, dev, prod)', 'prod')
    .action(async (extensionId: string, opts: { env: 'local' | 'dev' | 'prod' }) => {
      const { deleteExtension } = await import('./delete.js');
      await deleteExtension(extensionId, opts.env);
    });

  program
    .command('publish-public')
    .description('Publish an uploaded extension to the public marketplace.')
    .argument('<extension-id>', 'extension to publish')
    .option('--env <env>', 'environment (local, dev, prod)', 'prod')
    .action(async (extensionId: string, opts: { env: 'local' | 'dev' | 'prod' }) => {
      const { publishPublic } = await import('./publish.js');
      await publishPublic(extensionId, opts.env);
    });

  program
    .command('unpublish')
    .description('Remove an extension from the public marketplace (keeps it in your library).')
    .argument('<extension-id>', 'extension to unpublish')
    .option('--env <env>', 'environment (local, dev, prod)', 'prod')
    .action(async (extensionId: string, opts: { env: 'local' | 'dev' | 'prod' }) => {
      const { unpublish } = await import('./publish.js');
      await unpublish(extensionId, opts.env);
    });
}

await program.parseAsync(process.argv);
