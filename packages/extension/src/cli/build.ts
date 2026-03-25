/**
 * rool-extension build
 *
 * Builds the extension with Vite without publishing.
 *
 * Usage: npx rool-extension build
 */

import { readManifestOrExit, formatBytes } from './vite-utils.js';
import { buildExtension } from './build-pipeline.js';

export async function build() {
  const cwd = process.cwd();
  const manifest = readManifestOrExit(cwd);

  console.log(`\n  Building ${manifest.name}...\n`);
  const { totalSize } = await buildExtension(cwd, manifest);
  console.log(`\n  Build complete — ${formatBytes(totalSize)}`);
  console.log(`  Output: dist/\n`);
}
