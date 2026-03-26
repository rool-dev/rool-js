/**
 * Extension build pipeline.
 *
 * Runs a Vite production build for a Rool extension project, producing a ready-to-deploy
 * dist/ directory with index.html, compiled assets, and manifest.json.
 */

import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import type { Manifest } from '../manifest.js';
import { getSvelteAliases } from './vite-utils.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Vite build plugin (production version of the dev virtual entry)
// ---------------------------------------------------------------------------

function roolExtensionBuildPlugin(root: string, tailwindCssPath: string): import('vite').Plugin {
  const VIRTUAL_ENTRY = 'virtual:rool-extension-entry';
  const RESOLVED_ENTRY = '\0' + VIRTUAL_ENTRY;

  const VIRTUAL_CSS = 'virtual:rool-extension-tailwind.css';
  const RESOLVED_CSS = '\0' + VIRTUAL_CSS;

  const appPath = resolve(root, 'App.svelte');
  const cssPath = resolve(root, 'app.css');
  const hasCss = existsSync(cssPath);

  return {
    name: 'rool-extension-build',
    resolveId(id) {
      if (id === VIRTUAL_ENTRY) return RESOLVED_ENTRY;
      if (id === VIRTUAL_CSS) return RESOLVED_CSS;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED_CSS) return `@import "${tailwindCssPath}";\n@custom-variant dark (&:where(.dark, .dark *));`;
      if (id !== RESOLVED_ENTRY) return;
      return [
        `import { initExtension } from '@rool-dev/extension';`,
        `import { mount } from 'svelte';`,
        `import App from '${appPath}';`,
        `import '${VIRTUAL_CSS}';`,
        hasCss ? `import '${cssPath}';` : ``,
        ``,
        `async function main() {`,
        `  const channel = await initExtension();`,
        `  mount(App, {`,
        `    target: document.getElementById('app'),`,
        `    props: { channel },`,
        `  });`,
        `}`,
        ``,
        `main().catch((err) => {`,
        `  document.getElementById('app').innerHTML =`,
        `    '<div style="padding:2rem;color:red"><h2>Failed to initialize extension</h2><p>' + err.message + '</p></div>';`,
        `});`,
      ].filter(Boolean).join('\n');
    },
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Run a Vite production build for a Rool extension.
 * Produces dist/ with compiled assets, index.html, and manifest.json.
 */
export async function buildExtension(cwd: string, manifest: Manifest): Promise<{ outDir: string; totalSize: number }> {
  const tailwindPkgDir = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
  const tailwindCssPath = resolve(tailwindPkgDir, 'index.css');
  const extensionPkgPath = resolve(__dirname, '..');

  const outDir = resolve(cwd, 'dist');

  await build({
    configFile: false,
    root: cwd,
    build: {
      outDir,
      emptyOutDir: true,
      rolldownOptions: {
        input: 'virtual:rool-extension-entry',
      },
    },
    resolve: {
      alias: [
        { find: '@rool-dev/extension', replacement: extensionPkgPath },
        { find: /^tailwindcss$/, replacement: tailwindCssPath },
        ...getSvelteAliases(),
      ],
    },
    plugins: [
      tailwindcss(),
      svelte(),
      roolExtensionBuildPlugin(cwd, tailwindCssPath),
    ],
    logLevel: 'warn',
  });

  // Copy manifest.json into dist
  copyFileSync(resolve(cwd, 'manifest.json'), resolve(outDir, 'manifest.json'));

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

const ZIP_EXCLUDE = ['node_modules/**', '.git/**'];

/** Zip the project directory into a Buffer, excluding node_modules and .git. */
export function zipProject(projectDir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.glob('**/*', { cwd: projectDir, ignore: ZIP_EXCLUDE, dot: false });
    archive.finalize();
  });
}
