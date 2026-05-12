/**
 * Builds the fs host bundle used by `rool-extension preview`.
 *
 * Output: dist/dev/fs-host.js
 *
 * FsChannel + BridgeHost over an iframe. Served by the in-VM HTTP server
 * that the preview daemon stands up.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

export default defineConfig({
  build: {
    lib: {
      entry: resolve(root, 'src/dev/fs-host.ts'),
      formats: ['es'],
      fileName: 'fs-host',
    },
    outDir: resolve(root, 'dist/dev'),
    emptyOutDir: false,
    codeSplitting: false,
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@rool-dev/sdk': resolve(root, '../sdk/src/index.ts'),
    },
  },
});
