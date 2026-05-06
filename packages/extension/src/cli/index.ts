#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

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

program
  .command('init [name]')
  .description('Scaffold a new extension project.')
  .action(async () => {
    const { init } = await import('./init.js');
    init();
  });

program
  .command('dev')
  .description('Start the dev server with the host shell.')
  .action(async () => {
    const { dev } = await import('./dev.js');
    await dev();
  });

program
  .command('build')
  .description('Build the extension into ./dist.')
  .action(async () => {
    const { build } = await import('./build.js');
    await build();
  });

program
  .command('upload')
  .description('Build and upload the extension to your library. Use --publish to also publish.')
  .action(async () => {
    const { upload } = await import('./upload.js');
    await upload();
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
    'Start a new preview session: restart the daemon with a fresh snapshot, reset the ' +
    'step counter to 0, and wipe ./screenshots/. Use after `build` to pick up code changes.',
  )
  .action(async () => {
    const { reset } = await import('./preview/reset.js');
    await reset();
  });

await program.parseAsync(process.argv);
