/**
 * rool-app build
 *
 * Builds the app with Vite without publishing.
 *
 * Usage: npx rool-app build
 */

import { readManifestOrExit, formatBytes } from './vite-utils.js';
import { buildApp } from './build-pipeline.js';

export async function build() {
  const cwd = process.cwd();
  const manifest = readManifestOrExit(cwd);

  console.log(`\n  Building ${manifest.name}...\n`);
  const { totalSize } = await buildApp(cwd, manifest);
  console.log(`\n  Build complete — ${formatBytes(totalSize)}`);
  console.log(`  Output: dist/\n`);
}
