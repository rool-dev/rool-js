/**
 * Shared state, paths, and utilities for the `preview` subcommands.
 *
 * One daemon per extension (keyed by manifest.id), state under
 * /tmp/rool-preview/<id>/. Multiple extensions can preview concurrently.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { Manifest } from '../../manifest.js';
import { readManifest } from '../vite-utils.js';

export const STATE_ROOT = '/tmp/rool-preview';

export interface PreviewState {
  extensionId: string;
  pid: number;
  serverPort: number;
  cdpPort: number;
  browserWsUrl: string;
  targetId: string;
  startedAt: number;
  width: number;
  height: number;
  cwd: string;
}

/** Read manifest.json from cwd; exits with a clear message if missing or invalid. */
export function requireManifest(): Manifest {
  const result = readManifest(process.cwd());
  if (result.error !== null) {
    console.error(`Run from an extension project directory (${result.error}).`);
    process.exit(1);
  }
  return result.manifest;
}

export function stateDirFor(extensionId: string): string {
  return resolve(STATE_ROOT, extensionId);
}

export function stateFileFor(extensionId: string): string {
  return resolve(stateDirFor(extensionId), 'state.json');
}

export function logFileFor(extensionId: string): string {
  return resolve(stateDirFor(extensionId), 'daemon.log');
}

export function userDataDirFor(extensionId: string): string {
  return resolve(stateDirFor(extensionId), 'cdp');
}

export function ensureStateDir(extensionId: string): void {
  mkdirSync(stateDirFor(extensionId), { recursive: true });
}

export function readState(extensionId: string): PreviewState | null {
  const path = stateFileFor(extensionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PreviewState;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the pid exists but we lack signal permission — still "alive".
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
