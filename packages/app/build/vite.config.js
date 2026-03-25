/**
 * Builds the dev host shell into a self-contained ES module bundle.
 *
 * The output (dist/dev/host-shell.js) bundles @rool-dev/sdk and the bridge host
 * so applet developers don't need the SDK in their own node_modules.
 *
 * Run: pnpm build:host-shell  (or as part of the full build)
 */

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

export default defineConfig({
  build: {
    lib: {
      entry: resolve(root, 'src/dev/host-shell.ts'),
      formats: ['es'],
      fileName: 'host-shell',
    },
    outDir: resolve(root, 'dist/dev'),
    emptyOutDir: false,
    // Bundle everything — no externals
    // Single chunk, no code-splitting
    codeSplitting: false,
    // Dev-only tool, no need to minify for readability during debugging
    minify: false,
    sourcemap: true,
  },
  plugins: [
    tailwindcss(),
    svelte({
      compilerOptions: {
        css: 'injected',
      },
    }),
  ],
  resolve: {
    alias: {
      // Resolve workspace packages to their source
      '@rool-dev/sdk': resolve(root, '../sdk/src/index.ts'),
    },
  },
});
