/**
 * Shared Vite utilities for the CLI (dev server and publish).
 *
 * Node.js only — not included in the browser bundle.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Manifest, ManifestResult } from '../manifest.js';

// ---------------------------------------------------------------------------
// Manifest reading
// ---------------------------------------------------------------------------

export function readManifest(root: string): ManifestResult {
  const path = resolve(root, 'manifest.json');
  if (!existsSync(path)) {
    return { manifest: null, error: 'manifest.json not found' };
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    return { manifest: null, error: `Cannot read manifest.json: ${e instanceof Error ? e.message : String(e)}` };
  }
  let parsed: Manifest;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { manifest: null, error: 'manifest.json contains invalid JSON' };
  }
  const missing: string[] = [];
  if (!parsed.id) missing.push('id');
  if (!parsed.name) missing.push('name');
  if (!parsed.collections || typeof parsed.collections !== 'object') missing.push('collections');
  if (missing.length > 0) {
    return { manifest: null, error: `manifest.json missing required fields: ${missing.join(', ')}` };
  }
  return { manifest: parsed, error: null };
}

/**
 * Strict manifest reading for publish — exits on error.
 */
export function readManifestOrExit(root: string): Manifest {
  const result = readManifest(root);
  if (result.error !== null) {
    console.error(result.error);
    process.exit(1);
  }
  return result.manifest;
}

// ---------------------------------------------------------------------------
// Svelte resolution
// ---------------------------------------------------------------------------

/**
 * Builds resolve.alias entries that map every `svelte` and `svelte/*` import
 * to the exact file in the CLI's own svelte copy. This ensures the compiler
 * (loaded from the CLI) and the browser runtime always use the same svelte
 * instance — even when the extension lives outside the monorepo.
 */
export function getSvelteAliases(): { find: RegExp; replacement: string }[] {
  const svelteDir = dirname(fileURLToPath(import.meta.resolve('svelte/package.json')));
  const pkg = JSON.parse(readFileSync(resolve(svelteDir, 'package.json'), 'utf-8'));
  const aliases: { find: RegExp; replacement: string }[] = [];

  for (const [exportPath, conditions] of Object.entries(pkg.exports as Record<string, unknown>)) {
    const file = pickExport(conditions, ['svelte', 'browser', 'default']);
    if (!file) continue;
    const specifier = exportPath === '.' ? 'svelte' : 'svelte' + exportPath.slice(1);
    aliases.push({
      find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      replacement: resolve(svelteDir, file),
    });
  }

  return aliases;
}

/** Walk a conditional exports value, picking the first matching condition. */
function pickExport(value: unknown, conditions: string[]): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return null;
  for (const c of conditions) {
    if (c in (value as Record<string, unknown>)) {
      const r = pickExport((value as Record<string, unknown>)[c], conditions);
      if (r) return r;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
