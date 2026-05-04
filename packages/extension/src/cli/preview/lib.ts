/**
 * Shared state and utilities for `preview` and `screenshot`.
 *
 * One daemon with global state at /tmp/rool-preview/state.json.
 * The state file records which extension is loaded
 * so cwd-mismatched commands can give a clear error.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { Manifest } from '../../manifest.js';
import { readManifest } from '../vite-utils.js';

export const STATE_ROOT = '/tmp/rool-preview';
export const STATE_FILE = resolve(STATE_ROOT, 'state.json');
export const LOG_FILE = resolve(STATE_ROOT, 'daemon.log');
export const USER_DATA_DIR = resolve(STATE_ROOT, 'cdp');
export const SYNTH_SNAPSHOT_FILE = resolve(STATE_ROOT, 'empty-snapshot.json');
export const SYNTH_INFO_FILE = resolve(STATE_ROOT, 'empty-snapshot.info.json');


// hardcoded assumptions when agent owns the preview
export const AGENT_SNAPSHOT_PATH = '/space/snapshot.json';
export const AGENT_INFO_PATH = '/space/info.json';

export interface PreviewState {
  pid: number;
  serverPort: number;
  browserWsUrl: string;
  targetId: string;
  extensionId: string;
  extensionName: string;
}

export function isAgentMode(): boolean {
  return !!process.env['ROOL_AGENT_MODE'];
}

/** Resolve snapshot + info paths for the current mode. */
export function snapshotPaths(): { snapshotPath: string; infoPath: string } {
  return isAgentMode()
    ? { snapshotPath: AGENT_SNAPSHOT_PATH, infoPath: AGENT_INFO_PATH }
    : { snapshotPath: SYNTH_SNAPSHOT_FILE, infoPath: SYNTH_INFO_FILE };
}

export function ensureStateDir(): void {
  mkdirSync(STATE_ROOT, { recursive: true });
}

export function readState(): PreviewState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as PreviewState;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function requireManifestAt(root: string): Manifest {
  const result = readManifest(root);
  if (result.error !== null) {
    console.error(`No extension at ${root} (${result.error}).`);
    process.exit(1);
  }
  return result.manifest;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
