/**
 * `rool-extension preview start` — boot the headless preview daemon.
 *
 * Re-execs the same CLI script with ROOL_PREVIEW_DAEMON=1 so the daemon
 * lives in its own process, detached from the parent shell.
 */

import { spawn } from 'child_process';
import { existsSync, openSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  ensureStateDir,
  isPidAlive,
  logFileFor,
  readState,
  requireManifest,
  sleep,
  stateFileFor,
} from './lib.js';

interface StartOpts {
  width: string;
  height: string;
}

const READY_TIMEOUT_MS = 60_000;

export async function previewStart(opts: StartOpts): Promise<void> {
  const manifest = requireManifest();
  const extensionId = manifest.id;
  const cwd = process.cwd();
  const distDir = resolve(cwd, 'dist');
  const width = Number(opts.width);
  const height = Number(opts.height);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    console.error('--width and --height must be positive integers.');
    process.exit(1);
  }

  if (!existsSync(distDir) || !existsSync(resolve(distDir, 'index.html'))) {
    console.error(`No built extension at ${distDir} — run \`rool-extension build\` first.`);
    process.exit(1);
  }

  const existing = readState(extensionId);
  if (existing && isPidAlive(existing.pid)) {
    console.error(
      `Preview already running for "${extensionId}" (pid ${existing.pid}). ` +
      `Run \`rool-extension preview stop\` first.`,
    );
    process.exit(1);
  }

  ensureStateDir(extensionId);
  const logPath = logFileFor(extensionId);
  const logFd = openSync(logPath, 'w');

  // Re-exec the CLI script under daemon mode. import.meta.url resolves to
  // .../dist/cli/preview/start.js after build; the CLI entry is at ../index.js.
  const scriptPath = fileURLToPath(new URL('../index.js', import.meta.url));

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      ROOL_PREVIEW_DAEMON: '1',
      ROOL_PREVIEW_EXTENSION_ID: extensionId,
      ROOL_PREVIEW_CWD: cwd,
      ROOL_PREVIEW_DIST_DIR: distDir,
      ROOL_PREVIEW_WIDTH: String(width),
      ROOL_PREVIEW_HEIGHT: String(height),
    },
  });
  child.unref();

  if (!child.pid) {
    console.error('Failed to spawn preview daemon.');
    process.exit(1);
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(stateFileFor(extensionId))) {
      const s = readState(extensionId);
      if (s) {
        console.log(`Preview ready: ${manifest.name} (${extensionId})`);
        console.log(`  pid:        ${s.pid}`);
        console.log(`  http:       http://127.0.0.1:${s.serverPort}/`);
        console.log(`  devtools:   ws://127.0.0.1:${s.cdpPort}/devtools/browser/...`);
        console.log(`  state:      ${stateFileFor(extensionId)}`);
        console.log(`  log:        ${logPath}`);
        return;
      }
    }
    if (!isPidAlive(child.pid)) {
      console.error(`Daemon exited before becoming ready. Tail of ${logPath}:`);
      try {
        const log = readFileSync(logPath, 'utf-8');
        console.error(log.split('\n').slice(-30).join('\n'));
      } catch { /* */ }
      process.exit(1);
    }
    await sleep(100);
  }

  console.error(`Daemon timed out becoming ready after ${READY_TIMEOUT_MS}ms. See ${logPath}.`);
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* */ }
  process.exit(1);
}
