#!/usr/bin/env node
/**
 * rool-extension CLI entry point.
 *
 * Top-of-file daemon shortcut: when start.ts re-execs this script with
 * ROOL_PREVIEW_DAEMON=1, hand straight off to the daemon and never run
 * commander. Keeps daemon spawn flat (one node binary, one script, no
 * subcommand juggling across detached processes).
 */

import { Command } from 'commander';

if (process.env.ROOL_PREVIEW_DAEMON === '1') {
  const { previewDaemon } = await import('./preview/daemon.js');
  await previewDaemon();
  process.exit(0);
}

const program = new Command();

program
  .name('rool-extension')
  .description('Build, run, and publish Rool extensions.');

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

const preview = program
  .command('preview')
  .description(
    'Headless preview of the extension in cwd against a detached snapshot of the space.\n' +
    '\n' +
    'Lifecycle: one daemon per extension (keyed by manifest.id), one chromium tab.\n' +
    'The space snapshot is loaded once at `start` and held in memory; mutations\n' +
    'the extension performs accumulate there until `stop`.'
  );

preview
  .command('start')
  .description('Start the headless preview daemon for the extension in cwd.')
  .option('--width <px>', 'Viewport width in CSS pixels', '1280')
  .option('--height <px>', 'Viewport height in CSS pixels', '800')
  .action(async (opts) => {
    const { previewStart } = await import('./preview/start.js');
    await previewStart(opts);
  });

preview
  .command('stop')
  .description('Stop the headless preview daemon for the extension in cwd.')
  .action(async () => {
    const { previewStop } = await import('./preview/stop.js');
    await previewStop();
  });

preview
  .command('status')
  .description('List running preview sessions across all extensions.')
  .action(async () => {
    const { previewStatus } = await import('./preview/status.js');
    await previewStatus();
  });

preview
  .command('screenshot')
  .description('Capture a PNG screenshot of the running preview.')
  .requiredOption('--out <path>', 'Output PNG path')
  .action(async (opts) => {
    const { previewScreenshot } = await import('./preview/screenshot.js');
    await previewScreenshot(opts);
  });

await program.parseAsync(process.argv);
