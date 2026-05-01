/**
 * `preview` daemon — long-lived child of `rool-extension preview start`.
 *
 * Stands up:
 *   - HTTP server on 127.0.0.1:0 serving the host shell, snapshot bundle,
 *     /space/snapshot.json, and the extension dist.
 *   - One chromium-headless-shell process pointed at the host shell URL.
 *
 * Drives Chromium via CDP to attach to the page target and waits for
 * window.__roolReady before writing state.json.
 *
 * Subsequent `screenshot` / future interaction commands open their own CDP
 * connection to the same browser, attach to the same target, run their op,
 * and disconnect — the daemon stays out of the per-command path so each
 * command is independent and crash-safe. The daemon's only job after
 * bootstrap is to keep chromium alive and the in-memory snapshot state
 * intact.
 *
 * Lifecycle: started by start.ts via re-exec'ing the CLI script with
 * ROOL_PREVIEW_DAEMON=1; receives all config via env vars (detached spawn
 * loses argv ergonomics). Killed by stop.ts via SIGTERM → SIGKILL.
 */

import { spawn, type ChildProcess } from 'child_process';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from 'http';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { extname, join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CdpClient } from './cdp.js';
import {
  ensureStateDir,
  sleep,
  stateFileFor,
  userDataDirFor,
  type PreviewState,
} from './lib.js';

const SNAPSHOT_PATH = '/space/snapshot.json';
const INFO_PATH = '/space/info.json';
const CHROMIUM_BIN = process.env.ROOL_CHROMIUM ?? 'chromium-headless-shell';
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;
const TARGET_DISCOVERY_TIMEOUT_MS = 5_000;
const DEVTOOLS_URL_TIMEOUT_MS = 15_000;

// Snapshot host bundle ships next to the CLI in dist/dev/snapshot-host.js.
// __filename = .../dist/cli/preview/daemon.js  →  .../dist/dev/snapshot-host.js
const SNAPSHOT_HOST_BUNDLE = resolve(
  fileURLToPath(import.meta.url),
  '../../../dev/snapshot-host.js',
);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

interface ServerOpts {
  distDir: string;
  snapshotPath: string;
  infoPath: string;
  channelId: string;
  spaceId: string;
  spaceName: string;
}

function contentTypeFor(p: string): string {
  return CONTENT_TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHostHtml(opts: { channelId: string; spaceId: string; spaceName: string }): string {
  // Iframe fills the body so a viewport screenshot equals an extension screenshot.
  return `<!DOCTYPE html>
<html lang="en" style="height:100%">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.spaceName)}</title>
  <style>html,body,#rool-snapshot-host{height:100%;width:100%;margin:0;background:#fff}</style>
</head>
<body>
  <div id="rool-snapshot-host"
    data-extension-url="/ext/"
    data-snapshot-url="/snapshot.json"
    data-channel-id="${escapeHtml(opts.channelId)}"
    data-space-id="${escapeHtml(opts.spaceId)}"
    data-space-name="${escapeHtml(opts.spaceName)}"></div>
  <script type="module" src="/snapshot-host.js"></script>
</body>
</html>`;
}

/** Resolve a request path under root, refusing escapes via .. */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + '/')) return null;
  return target;
}

function handleRequest(req: IncomingMessage, res: ServerResponse, opts: ServerOpts): void {
  const url = req.url ?? '/';
  const pathname = url.split('?')[0];

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const html = buildHostHtml(opts);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (pathname === '/snapshot-host.js') {
      const buf = readFileSync(SNAPSHOT_HOST_BUNDLE);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(buf);
      return;
    }
    if (pathname === '/snapshot.json') {
      const buf = readFileSync(opts.snapshotPath);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(buf);
      return;
    }
    if (pathname === '/info.json' && existsSync(opts.infoPath)) {
      const buf = readFileSync(opts.infoPath);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(buf);
      return;
    }
    if (pathname.startsWith('/ext/')) {
      const subPath = pathname.slice('/ext/'.length) || 'index.html';
      const target = safeJoin(opts.distDir, subPath);
      if (!target || !existsSync(target)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const stat = statSync(target);
      if (stat.isDirectory()) {
        const idx = resolve(target, 'index.html');
        if (existsSync(idx)) {
          const idxStat = statSync(idx);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': String(idxStat.size),
          });
          createReadStream(idx).pipe(res);
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentTypeFor(target),
        'Content-Length': String(stat.size),
      });
      createReadStream(target).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(msg);
  }
}

async function startHttpServer(opts: ServerOpts): Promise<{ port: number; url: string; server: Server }> {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((req, res) => handleRequest(req, res, opts));
    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        rejectServer(new Error('Failed to read server address'));
        return;
      }
      resolveServer({ port: addr.port, url: `http://127.0.0.1:${addr.port}/`, server });
    });
  });
}

interface ChromiumHandle {
  proc: ChildProcess;
  browserWsUrl: string;
  cdpPort: number;
}

async function spawnChromium(args: {
  userDataDir: string;
  width: number;
  height: number;
  startUrl: string;
}): Promise<ChromiumHandle> {
  const argv = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    `--user-data-dir=${args.userDataDir}`,
    `--window-size=${args.width},${args.height}`,
    args.startUrl,
  ];
  const proc = spawn(CHROMIUM_BIN, argv, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Chromium writes its DevTools URL to stderr once it's listening:
  //   "DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<uuid>"
  return new Promise<ChromiumHandle>((resolveProc, rejectProc) => {
    let buf = '';
    let settled = false;
    const settleErr = (err: Error) => {
      if (settled) return;
      settled = true;
      rejectProc(err);
    };
    const settleOk = (v: { browserWsUrl: string; cdpPort: number }) => {
      if (settled) return;
      settled = true;
      resolveProc({ proc, ...v });
    };

    proc.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf-8');
      buf += s;
      // Echo chromium logs so they land in daemon.log.
      process.stderr.write(s);
      const m = buf.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[A-Za-z0-9-]+)/);
      if (m) settleOk({ browserWsUrl: m[1], cdpPort: Number(m[2]) });
    });
    proc.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    proc.once('exit', (code, signal) => {
      settleErr(new Error(
        `chromium exited before DevTools URL emitted (code=${code} signal=${signal}). Stderr tail:\n${buf.slice(-1000)}`,
      ));
    });
    proc.once('error', (err) => {
      settleErr(new Error(`Failed to spawn ${CHROMIUM_BIN}: ${err.message}`));
    });
    setTimeout(
      () => settleErr(new Error(`Timed out waiting for DevTools URL (chromium=${CHROMIUM_BIN})`)),
      DEVTOOLS_URL_TIMEOUT_MS,
    );
  });
}

function fail(msg: string): never {
  console.error(`[preview-daemon] ${msg}`);
  process.exit(1);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) fail(`Required env var ${name} not set`);
  return v;
}

export async function previewDaemon(): Promise<void> {
  const extensionId = required('ROOL_PREVIEW_EXTENSION_ID');
  const cwd = required('ROOL_PREVIEW_CWD');
  const distDir = required('ROOL_PREVIEW_DIST_DIR');
  const width = Number(required('ROOL_PREVIEW_WIDTH'));
  const height = Number(required('ROOL_PREVIEW_HEIGHT'));

  ensureStateDir(extensionId);

  if (!existsSync(distDir) || !existsSync(resolve(distDir, 'index.html'))) {
    fail(`No built extension at ${distDir} (run \`rool-extension build\` first).`);
  }
  if (!existsSync(SNAPSHOT_PATH)) {
    fail(`No space snapshot at ${SNAPSHOT_PATH} (this command runs only inside the sandbox VM).`);
  }
  if (!existsSync(SNAPSHOT_HOST_BUNDLE)) {
    fail(`Snapshot host bundle missing at ${SNAPSHOT_HOST_BUNDLE} — package build is incomplete.`);
  }

  let spaceId = extensionId;
  let spaceName = 'Snapshot';
  if (existsSync(INFO_PATH)) {
    try {
      const info = JSON.parse(readFileSync(INFO_PATH, 'utf-8')) as { spaceId?: string; name?: string };
      if (info.spaceId) spaceId = info.spaceId;
      if (info.name) spaceName = info.name;
    } catch {
      // ignore — info.json is best-effort
    }
  }

  const { port: serverPort, url: hostUrl, server } = await startHttpServer({
    distDir,
    snapshotPath: SNAPSHOT_PATH,
    infoPath: INFO_PATH,
    channelId: extensionId,
    spaceId,
    spaceName,
  });
  console.log(`[preview-daemon] http server listening on ${hostUrl}`);

  const userDataDir = userDataDirFor(extensionId);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  const chromium = await spawnChromium({ userDataDir, width, height, startUrl: hostUrl });
  console.log(`[preview-daemon] chromium pid=${chromium.proc.pid} cdpPort=${chromium.cdpPort}`);

  const cdp = await CdpClient.connect(chromium.browserWsUrl);

  // Wait for the initial page target to be discoverable.
  let pageTarget: { targetId: string; type: string; url: string } | undefined;
  const targetDeadline = Date.now() + TARGET_DISCOVERY_TIMEOUT_MS;
  while (!pageTarget && Date.now() < targetDeadline) {
    const t = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>(
      'Target.getTargets',
    );
    pageTarget = t.targetInfos.find((x) => x.type === 'page');
    if (!pageTarget) await sleep(100);
  }
  if (!pageTarget) fail('No page target found in chromium');

  const { sessionId } = await cdp.send<{ sessionId: string }>(
    'Target.attachToTarget',
    { targetId: pageTarget.targetId, flatten: true },
  );

  // Poll for window.__roolReady. Surface __roolError if the snapshot host
  // bootstrap failed (e.g. malformed snapshot.json).
  const readyDeadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < readyDeadline) {
    const r = await cdp.send<{ result: { value?: { ready?: boolean; error?: string | null } } }>(
      'Runtime.evaluate',
      {
        expression: '({ ready: window.__roolReady === true, error: window.__roolError ?? null })',
        returnByValue: true,
      },
      sessionId,
    );
    const v = r.result.value;
    if (v?.error) fail(`Snapshot host bootstrap failed: ${v.error}`);
    if (v?.ready) {
      ready = true;
      break;
    }
    await sleep(READY_POLL_MS);
  }
  if (!ready) {
    console.error(`[preview-daemon] window.__roolReady never set within ${READY_TIMEOUT_MS}ms — proceeding anyway`);
  }

  const state: PreviewState = {
    extensionId,
    pid: process.pid,
    serverPort,
    cdpPort: chromium.cdpPort,
    browserWsUrl: chromium.browserWsUrl,
    targetId: pageTarget.targetId,
    startedAt: Date.now(),
    width,
    height,
    cwd,
  };
  writeFileSync(stateFileFor(extensionId), JSON.stringify(state, null, 2));
  console.log(`[preview-daemon] ready: ${stateFileFor(extensionId)}`);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { rmSync(stateFileFor(extensionId), { force: true }); } catch { /* */ }
    try { server.close(); } catch { /* */ }
    try { cdp.close(); } catch { /* */ }
  };

  chromium.proc.once('exit', (code, signal) => {
    console.error(`[preview-daemon] chromium exited code=${code} signal=${signal}`);
    cleanup();
    process.exit(code ?? 1);
  });
  process.on('SIGTERM', () => {
    cleanup();
    try { chromium.proc.kill('SIGKILL'); } catch { /* */ }
    process.exit(0);
  });
  process.on('SIGINT', () => {
    cleanup();
    try { chromium.proc.kill('SIGKILL'); } catch { /* */ }
    process.exit(0);
  });

  // Block forever; subsequent commands open their own CDP connections.
  await new Promise<void>(() => { /* never resolves */ });
}
