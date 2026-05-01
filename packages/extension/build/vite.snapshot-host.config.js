/**
 * Builds the snapshot host bundle used by `rool-extension preview`.
 *
 * Output: dist/dev/snapshot-host.js
 *
 * Stripped cousin of host-shell.js: SnapshotChannel + BridgeHost over an
 * iframe, no Sidebar / DevHostController / GraphQL. Served by the in-VM HTTP
 * server that the preview daemon stands up.
 *
 * Single-entry config (rather than a sibling entry under host-shell's config)
 * so the two bundles are fully self-contained — vite would otherwise hoist
 * shared deps into a third chunk and the daemon would have to serve N files.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

export default defineConfig({
  build: {
    lib: {
      entry: resolve(root, 'src/dev/snapshot-host.ts'),
      formats: ['es'],
      fileName: 'snapshot-host',
    },
    outDir: resolve(root, 'dist/dev'),
    emptyOutDir: false,
    codeSplitting: false,
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      // Resolve workspace packages to their source
      '@rool-dev/sdk': resolve(root, '../sdk/src/index.ts'),
    },
  },
});
