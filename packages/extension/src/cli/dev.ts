/**
 * rool-extension dev
 *
 * Starts the extension's Vite dev server with the dev host shell injected.
 * The host shell is served at /__rool-host/ and the extension at /.
 *
 * Usage: npx rool-extension dev
 */

import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, existsSync, watch } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ManifestResult } from '../manifest.js';
import { readManifest, getSvelteAliases } from './vite-utils.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_SHELL_JS_PATH = resolve(__dirname, '../dev/host-shell.js');

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateHostHtml(result: ManifestResult): string {
  const { manifest, error } = result;
  const channelId = manifest?.id ?? 'extension-dev';
  const dataAttrs: Record<string, string> = {
    'data-channel-id': channelId,
    'data-extension-url': '/',
  };
  if (manifest) dataAttrs['data-manifest'] = escapeHtml(JSON.stringify(manifest));
  if (error) dataAttrs['data-manifest-error'] = escapeHtml(error);

  const attrs = Object.entries(dataAttrs).map(([k, v]) => `${k}="${v}"`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en" style="height:100%">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest?.name ? escapeHtml(manifest.name) + ' \u2014 ' : ''}Extension Dev Host</title>
  <script type="module" src="/@vite/client"></script>
</head>
<body style="height:100%;margin:0">
  <div id="rool-host"
    style="display:flex;height:100%;background:#f8fafc"
    ${attrs}
  ></div>
  <script type="module" src="/__rool-host/host-shell.js"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Vite plugins (internal — injected by the CLI, not user-facing)
// ---------------------------------------------------------------------------

/**
 * Synthesizes index.html and the extension entry module so extension projects
 * only need App.svelte + manifest.json.
 */
function roolExtensionPlugin(root: string, tailwindCssPath: string): Plugin {
  const VIRTUAL_ENTRY = 'virtual:rool-extension-entry';
  const RESOLVED_ENTRY = '\0' + VIRTUAL_ENTRY;

  const VIRTUAL_CSS = 'virtual:rool-extension-tailwind.css';
  const RESOLVED_CSS = '\0' + VIRTUAL_CSS;

  const appPath = resolve(root, 'App.svelte');
  const cssPath = resolve(root, 'app.css');
  const hasCss = existsSync(cssPath);

  return {
    name: 'rool-extension-entry',
    resolveId(id) {
      if (id === VIRTUAL_ENTRY) return RESOLVED_ENTRY;
      if (id === VIRTUAL_CSS) return RESOLVED_CSS;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED_CSS) return `@import "${tailwindCssPath}";`;
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
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Serve synthesized index.html at /
        if (req.url === '/' || req.url === '/index.html') {
          const html = `<!DOCTYPE html>
<html lang="en" style="height:100%">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extension</title>
</head>
<body style="height:100%;margin:0">
  <div id="app" style="height:100%"></div>
  <script type="module" src="/@id/${VIRTUAL_ENTRY}"></script>
</body>
</html>`;
          server.transformIndexHtml(req.url, html).then((transformed) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(transformed);
          }).catch(next);
          return;
        }
        next();
      });
    },
  };
}

function roolHostPlugin(state: { current: ManifestResult }, hostShellJs: string, cwd: string): Plugin {
  return {
    name: 'rool-extension-host',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__rool-host')) return next();

        // Build + zip endpoint for in-browser publishing
        if (req.url === '/__rool-host/publish' && req.method === 'POST') {
          try {
            const { buildExtension, zipProject } = await import('./build-pipeline.js');
            const { readManifestOrExit } = await import('./vite-utils.js');
            const manifest = readManifestOrExit(cwd);
            const { totalSize } = await buildExtension(cwd, manifest);
            const zipBuffer = await zipProject(cwd);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('X-Total-Size', String(totalSize));
            res.end(zipBuffer);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: msg }));
          }
          return;
        }

        if (req.url === '/__rool-host/host-shell.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(hostShellJs);
          return;
        }

        const html = generateHostHtml(state.current);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest file watcher
// ---------------------------------------------------------------------------

function watchManifest(root: string, state: { current: ManifestResult }, server: ViteDevServer) {
  const manifestPath = resolve(root, 'manifest.json');
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const prev = state.current;
      state.current = readManifest(root);

      if (JSON.stringify(prev) === JSON.stringify(state.current)) return;

      if (state.current.error) {
        console.warn(`\n  \u26a0  Manifest: ${state.current.error}\n`);
      } else {
        console.log(`\n  \u2713  Manifest updated \u2014 ${state.current.manifest!.name}\n`);
      }

      server.ws.send({ type: 'full-reload', path: '*' });
    }, 100);
  };

  // Watch the file (and parent dir so we catch creation/deletion)
  try {
    watch(manifestPath, onChange);
  } catch {
    // File may not exist yet — watch the directory instead
  }
  watch(root, (_, filename) => {
    if (filename === 'manifest.json') onChange();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function dev() {
  const cwd = process.cwd();
  const state = { current: readManifest(cwd) };

  if (state.current.error) {
    console.warn(`\n  \u26a0  Manifest: ${state.current.error}\n`);
  }

  // Load pre-built host shell bundle
  let hostShellJs: string;
  try {
    hostShellJs = readFileSync(HOST_SHELL_JS_PATH, 'utf-8');
  } catch {
    console.error(
      `Could not find host-shell.js at ${HOST_SHELL_JS_PATH}.\n` +
      `Run "pnpm build" in the @rool-dev/extension package first.`,
    );
    process.exit(1);
  }

  // Resolve packages from the CLI's own node_modules so apps don't need them
  // and to ensure a single copy of svelte (compiler + runtime must match)
  const tailwindPkgDir = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
  const tailwindCssPath = resolve(tailwindPkgDir, 'index.css');
  const extensionPkgPath = resolve(__dirname, '..');

  const server = await createServer({
    configFile: false,
    root: cwd,
    server: {
      open: '/__rool-host/',
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
      roolExtensionPlugin(cwd, tailwindCssPath),
      roolHostPlugin(state, hostShellJs, cwd),
    ],
  });

  await server.listen();
  server.printUrls();

  const name = state.current.manifest?.name ?? 'extension';
  console.log(`\n  Dev host ready \u2014 serving ${name} via bridge\n`);

  // Start watching the manifest for changes
  watchManifest(cwd, state, server);
}

