/**
 * `rool-extension preview stop` — terminate the preview daemon for the
 * extension in cwd. Idempotent: prints a no-op message if nothing's running.
 */

import { existsSync, rmSync } from 'fs';
import {
  isPidAlive,
  readState,
  requireManifest,
  sleep,
  stateFileFor,
} from './lib.js';

const GRACE_MS = 3_000;
const POLL_MS = 100;

export async function previewStop(): Promise<void> {
  const manifest = requireManifest();
  const extensionId = manifest.id;
  const state = readState(extensionId);

  if (!state) {
    console.log(`No preview running for "${extensionId}".`);
    return;
  }

  if (isPidAlive(state.pid)) {
    try { process.kill(state.pid, 'SIGTERM'); } catch { /* */ }
    const deadline = Date.now() + GRACE_MS;
    while (Date.now() < deadline) {
      if (!isPidAlive(state.pid)) break;
      await sleep(POLL_MS);
    }
    if (isPidAlive(state.pid)) {
      try { process.kill(state.pid, 'SIGKILL'); } catch { /* */ }
    }
  }

  if (existsSync(stateFileFor(extensionId))) {
    rmSync(stateFileFor(extensionId), { force: true });
  }
  console.log(`Stopped preview for "${extensionId}".`);
}
