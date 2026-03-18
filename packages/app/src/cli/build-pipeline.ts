/**
 * App build pipeline.
 *
 * Runs a Vite production build for a Rool app project, producing a ready-to-deploy
 * dist/ directory with index.html, compiled assets, and rool-app.json.
 */

import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import type { AppManifest } from '../manifest.js';
import { getSvelteAliases } from './vite-utils.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Vite build plugin (production version of the dev virtual entry)
// ---------------------------------------------------------------------------

function roolAppBuildPlugin(root: string, tailwindCssPath: string): import('vite').Plugin {
  const VIRTUAL_ENTRY = 'virtual:rool-app-entry';
  const RESOLVED_ENTRY = '\0' + VIRTUAL_ENTRY;

  const VIRTUAL_CSS = 'virtual:rool-app-tailwind.css';
  const RESOLVED_CSS = '\0' + VIRTUAL_CSS;

  const appPath = resolve(root, 'App.svelte');
  const cssPath = resolve(root, 'app.css');
  const hasCss = existsSync(cssPath);

  return {
    name: 'rool-app-build',
    resolveId(id) {
      if (id === VIRTUAL_ENTRY) return RESOLVED_ENTRY;
      if (id === VIRTUAL_CSS) return RESOLVED_CSS;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED_CSS) return `@import "${tailwindCssPath}";`;
      if (id !== RESOLVED_ENTRY) return;
      return [
        `import { initApp } from '@rool-dev/app';`,
        `import { mount } from 'svelte';`,
        `import App from '${appPath}';`,
        `import '${VIRTUAL_CSS}';`,
        hasCss ? `import '${cssPath}';` : ``,
        ``,
        `async function main() {`,
        `  const channel = await initApp();`,
        `  mount(App, {`,
        `    target: document.getElementById('app'),`,
        `    props: { channel },`,
        `  });`,
        `}`,
        ``,
        `main().catch((err) => {`,
        `  document.getElementById('app').innerHTML =`,
        `    '<div style="padding:2rem;color:red"><h2>Failed to initialize app</h2><p>' + err.message + '</p></div>';`,
        `});`,
      ].filter(Boolean).join('\n');
    },
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Run a Vite production build for a Rool app.
 * Produces dist/ with compiled assets, index.html, and rool-app.json.
 */
export async function buildApp(cwd: string, manifest: AppManifest): Promise<{ outDir: string; totalSize: number }> {
  const tailwindPkgDir = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
  const tailwindCssPath = resolve(tailwindPkgDir, 'index.css');
  const appPkgPath = resolve(__dirname, '..');

  const outDir = resolve(cwd, 'dist');

  await build({
    configFile: false,
    root: cwd,
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: 'virtual:rool-app-entry',
      },
    },
    resolve: {
      alias: [
        { find: '@rool-dev/app', replacement: appPkgPath },
        { find: /^tailwindcss$/, replacement: tailwindCssPath },
        ...getSvelteAliases(),
      ],
    },
    plugins: [
      tailwindcss(),
      svelte(),
      roolAppBuildPlugin(cwd, tailwindCssPath),
    ],
    logLevel: 'warn',
  });

  // Copy rool-app.json into dist
  copyFileSync(resolve(cwd, 'rool-app.json'), resolve(outDir, 'rool-app.json'));

  // Copy icon file into dist if specified
  if (manifest.icon) {
    const iconSrc = resolve(cwd, manifest.icon);
    if (existsSync(iconSrc)) {
      copyFileSync(iconSrc, resolve(outDir, manifest.icon));
    }
  }

  // Write index.html (Vite build doesn't generate one from virtual entry)
  const assets = readdirSync(resolve(outDir, 'assets')).filter(f => f.endsWith('.js') || f.endsWith('.css'));
  const jsFiles = assets.filter(f => f.endsWith('.js'));
  const cssFiles = assets.filter(f => f.endsWith('.css'));

  const indexHtml = `<!DOCTYPE html>
<html lang="en" style="height:100%">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.name}</title>
${cssFiles.map(f => `  <link rel="stylesheet" href="/assets/${f}">`).join('\n')}
</head>
<body style="height:100%;margin:0">
  <div id="app" style="height:100%"></div>
${jsFiles.map(f => `  <script type="module" src="/assets/${f}"></script>`).join('\n')}
</body>
</html>`;

  writeFileSync(resolve(outDir, 'index.html'), indexHtml);

  // Calculate total size
  let totalSize = 0;
  function walkDir(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walkDir(full);
      else totalSize += stat.size;
    }
  }
  walkDir(outDir);

  return { outDir, totalSize };
}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

/** Zip a directory into a Buffer. */
export function zipDirectory(dirPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.directory(dirPath, false);
    archive.finalize();
  });
}
