import { spawn } from 'child_process';
import { existsSync, openSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import type { Manifest } from '../../manifest.js';
import {
  ensureStateDir,
  isPidAlive,
  LOG_FILE,
  type PreviewState,
  readState,
  sleep,
} from './lib.js';

const READY_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 3_000;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

interface EnsureOpts {
  /** Always kill any existing daemon and spawn a fresh one. */
  reset?: boolean;
}

export async function ensurePreview(
  manifest: Manifest,
  distDir: string,
  opts: EnsureOpts = {},
): Promise<PreviewState> {
  if (!existsSync(distDir) || !existsSync(resolve(distDir, 'index.html'))) {
    console.error(`No built extension at ${distDir} — run \`rool-extension build\` first.`);
    process.exit(1);
  }

  const existing = readState();
  if (existing && isPidAlive(existing.pid)) {
    if (!opts.reset && existing.extensionId === manifest.id) {
      return existing;
    }
    await stopExisting(existing.pid);
  }

  return spawnPreviewDaemon(manifest, distDir);
}

async function spawnPreviewDaemon(manifest: Manifest, distDir: string): Promise<PreviewState> {
  ensureStateDir();
  const logFd = openSync(LOG_FILE, 'w');
  const scriptPath = fileURLToPath(new URL('../index.js', import.meta.url));
  const width = Number(process.env.ROOL_PREVIEW_WIDTH) || DEFAULT_WIDTH;
  const height = Number(process.env.ROOL_PREVIEW_HEIGHT) || DEFAULT_HEIGHT;

  console.log(`Starting preview daemon for "${manifest.name}" (${manifest.id})...`);

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      ROOL_PREVIEW_DAEMON: '1',
      ROOL_PREVIEW_EXTENSION_ID: manifest.id,
      ROOL_PREVIEW_EXTENSION_NAME: manifest.name,
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
    const s = readState();
    if (s && s.extensionId === manifest.id) return s;
    if (!isPidAlive(child.pid)) {
      console.error(`Daemon exited before becoming ready. Tail of ${LOG_FILE}:`);
      try {
        const log = readFileSync(LOG_FILE, 'utf-8');
        console.error(log.split('\n').slice(-30).join('\n'));
      } catch { /* */ }
      process.exit(1);
    }
    await sleep(100);
  }

  console.error(`Daemon timed out becoming ready after ${READY_TIMEOUT_MS}ms. See ${LOG_FILE}.`);
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* */ }
  process.exit(1);
}

async function stopExisting(pid: number): Promise<void> {
  try { process.kill(pid, 'SIGTERM'); } catch { /* */ }
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await sleep(100);
  }
  if (isPidAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* */ }
    await sleep(200);
  }
}
