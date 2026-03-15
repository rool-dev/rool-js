/**
 * rool-app publish
 *
 * Builds the app with Vite and publishes it to the Rool app platform.
 *
 * Usage: npx rool-app publish [--env dev|prod]
 */

import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import archiver from 'archiver';
import type { Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';
import { readManifestOrExit, getSvelteAliases } from './vite-utils.js';

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
// Zip
// ---------------------------------------------------------------------------

function zipDirectory(dirPath: string): Promise<Buffer> {
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

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { env: Environment } {
  const args = process.argv.slice(3); // after 'publish'
  let env: Environment = 'prod';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) {
      const val = args[i + 1];
      if (val !== 'dev' && val !== 'prod') {
        console.error(`Invalid environment: ${val}. Use 'dev' or 'prod'.`);
        process.exit(1);
      }
      env = val;
      i++;
    }
  }

  return { env };
}

// ---------------------------------------------------------------------------
// Build + Zip (reusable by both CLI and dev server)
// ---------------------------------------------------------------------------

export async function buildAndZip(cwd: string): Promise<{ zipBuffer: Buffer; totalSize: number }> {
  const manifest = readManifestOrExit(cwd);

  // Resolve packages from the CLI's own node_modules
  const tailwindPkgDir = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
  const tailwindCssPath = resolve(tailwindPkgDir, 'index.css');
  const appPkgPath = resolve(__dirname, '..');

  const outDir = resolve(cwd, 'dist');

  // Run Vite production build
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

  // Calculate size
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

  // Zip
  const zipBuffer = await zipDirectory(outDir);

  return { zipBuffer, totalSize };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function publish() {
  const cwd = process.cwd();
  const { env } = parseArgs();
  const manifest = readManifestOrExit(cwd);

  console.log(`\n  Building ${manifest.name}...\n`);
  const { zipBuffer, totalSize } = await buildAndZip(cwd);
  console.log(`\n  Build complete — ${formatBytes(totalSize)}`);
  console.log(`  Bundle: ${formatBytes(zipBuffer.length)}\n`);

  // Authenticate
  const urls = ENV_URLS[env];
  const client = new RoolClient({
    baseUrl: urls.baseUrl,
    authUrl: urls.authUrl,
    authProvider: new NodeAuthProvider(),
  });

  if (!await client.isAuthenticated()) {
    console.log('  Opening browser to authenticate...');
    await client.login('Rool App CLI');
  }

  // Publish
  console.log(`  Publishing ${manifest.id} to ${env}...`);
  const blob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
  const result = await client.publishApp(manifest.id, {
    name: manifest.name,
    bundle: blob,
    spa: false,
  });

  console.log(`\n  Published: ${result.name}`);
  console.log(`  URL: ${result.url}`);
  console.log(`  Size: ${formatBytes(result.sizeBytes)}\n`);

  client.destroy();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

publish().catch((err) => {
  console.error('Publish failed:', err.message || err);
  process.exit(1);
});
