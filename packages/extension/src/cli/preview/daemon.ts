/**
 * `preview` daemon — long-lived child of `rool-extension preview`.
 *
 * Stands up an HTTP server on 127.0.0.1:0 (extension dist at /, host shell
 * at /__rool-host/, space proxy at /__rool-host/space/...) and one chromium
 * process pointed at the host shell URL. Drives chromium via CDP, waits for
 * window.__roolReady, then writes state.json and idles forever.
 *
 * The space proxy reads and writes /space directly — that's a FUSE mount,
 * so schema validation, role-based ACL, and stamp attribution all happen in
 * the FUSE driver under the hood. Reactivity is fs.watch on /space.
 *
 * Subsequent `screenshot` / future interaction commands open their own CDP
 * connection to the same browser and attach to the same target — the daemon
 * stays out of the per-command path so each command is independent.
 *
 * Lifecycle: re-exec'd by `preview.ts` with ROOL_PREVIEW_DAEMON=1; takes
 * extension metadata via ROOL_PREVIEW_* env vars. Killed by `preview.ts`
 * (when switching extensions) via SIGTERM → SIGKILL.
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
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'fs';
import { extname, join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hostname } from 'os';
import { CdpClient } from './cdp.js';
import {
  ensureStateDir,
  sleep,
  STATE_FILE,
  USER_DATA_DIR,
  type PreviewState,
} from './lib.js';

const CHROMIUM_BIN = process.env.ROOL_CHROMIUM ?? 'chromium-headless-shell';
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;
const TARGET_DISCOVERY_TIMEOUT_MS = 5_000;
const DEVTOOLS_URL_TIMEOUT_MS = 15_000;

const FS_HOST_BUNDLE = resolve(
  fileURLToPath(import.meta.url),
  '../../../dev/fs-host.js',
);

const SPACE_ROOT = '/space';
const SCHEMA_BASENAME = '.schema.json';
const META_BASENAME = 'meta.json';
const STAMPS_DIR = '.stamps';
const RESERVED_COLLECTION_NAMES = new Set([STAMPS_DIR, 'meta']);
const COLLECTION_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const OBJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const STAMP_DEFAULT = {
  modifiedAt: 0,
  modifiedBy: '',
  modifiedByName: null,
  modifiedInChannel: '',
  modifiedInConversation: null,
  modifiedInInteraction: null,
} as const;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

interface ServerOpts {
  distDir: string;
  channelId: string;
  spaceId: string;
  spaceName: string;
}

const HOST_PREFIX = '/__rool-host';
const SPACE_PREFIX = `${HOST_PREFIX}/space`;

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
  return `<!DOCTYPE html>
<html lang="en" style="height:100%">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.spaceName)}</title>
  <style>html,body,#rool-fs-host{height:100%;width:100%;margin:0;background:#fff}</style>
</head>
<body>
  <div id="rool-fs-host"
    data-base-url="${SPACE_PREFIX}"
    data-extension-url="/"
    data-channel-id="${escapeHtml(opts.channelId)}"
    data-space-id="${escapeHtml(opts.spaceId)}"
    data-space-name="${escapeHtml(opts.spaceName)}"></div>
  <script type="module" src="${HOST_PREFIX}/fs-host.js"></script>
</body>
</html>`;
}

function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + '/')) return null;
  return target;
}

function serveDistFile(target: string, res: ServerResponse): void {
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
}

// ----------------------------------------------------------------------
// Space proxy — direct fs ops against /space (FUSE).
// ----------------------------------------------------------------------

interface Stamp {
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInChannel: string;
  modifiedInConversation: string | null;
  modifiedInInteraction: string | null;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readStamp(objectId: string): Stamp {
  const path = join(SPACE_ROOT, STAMPS_DIR, `${objectId}.json`);
  if (!existsSync(path)) return { ...STAMP_DEFAULT };
  try {
    const v = readJson(path);
    if (v && typeof v === 'object') return v as Stamp;
  } catch { /* fall through */ }
  return { ...STAMP_DEFAULT };
}

function listCollections(): string[] {
  if (!existsSync(SPACE_ROOT)) return [];
  return readdirSync(SPACE_ROOT).filter((name) => {
    if (RESERVED_COLLECTION_NAMES.has(name)) return false;
    try { return statSync(join(SPACE_ROOT, name)).isDirectory(); } catch { return false; }
  });
}

function listObjectFiles(collection: string): string[] {
  return readdirSync(join(SPACE_ROOT, collection))
    .filter((f) => f !== SCHEMA_BASENAME && f.endsWith('.json'));
}

function findObjectPath(objectId: string): { path: string; collection: string } | null {
  for (const c of listCollections()) {
    const p = join(SPACE_ROOT, c, `${objectId}.json`);
    if (existsSync(p)) return { path: p, collection: c };
  }
  return null;
}

interface Json { [k: string]: unknown }

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text) return {};
  return JSON.parse(text) as Json;
}

function getOverview(): Json {
  const schema: Json = {};
  const objectIds: string[] = [];
  const objectStats: Array<Json> = [];
  for (const c of listCollections()) {
    const sp = join(SPACE_ROOT, c, SCHEMA_BASENAME);
    if (existsSync(sp)) {
      try { schema[c] = readJson(sp); } catch { /* skip malformed */ }
    }
    for (const f of listObjectFiles(c)) {
      const id = f.slice(0, -'.json'.length);
      objectIds.push(id);
      objectStats.push({ id, ...readStamp(id) });
    }
  }
  let meta: Json = {};
  const metaPath = join(SPACE_ROOT, META_BASENAME);
  if (existsSync(metaPath)) {
    try {
      const v = readJson(metaPath);
      if (v && typeof v === 'object') meta = v as Json;
    } catch { /* skip */ }
  }
  return { objectIds, objectStats, schema, meta };
}

function getObject(objectId: string): Json | null {
  if (!OBJECT_ID_RE.test(objectId)) return null;
  const found = findObjectPath(objectId);
  if (!found) return null;
  const body = readJson(found.path) as Json;
  return { id: objectId, type: found.collection, ...body };
}

function createObject(data: Json): { objectId: string } {
  const type = data.type;
  const id = data.id;
  if (typeof type !== 'string' || !COLLECTION_NAME_RE.test(type)) {
    throw new HttpError(400, 'MISSING_OR_BAD_TYPE');
  }
  if (typeof id !== 'string' || !OBJECT_ID_RE.test(id)) {
    throw new HttpError(400, 'MISSING_OR_BAD_ID');
  }
  const dir = join(SPACE_ROOT, type);
  if (!existsSync(dir)) throw new HttpError(400, `UNKNOWN_COLLECTION: ${type}`);
  const target = join(dir, `${id}.json`);
  if (existsSync(target)) throw new HttpError(409, `OBJECT_EXISTS: ${id}`);
  const body: Json = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id' || k === 'type') continue;
    body[k] = v;
  }
  writeFileSync(target, JSON.stringify(body, null, 2) + '\n', 'utf-8');
  return { objectId: id };
}

function updateObject(objectId: string, set: Json, remove: string[]): { objectId: string } {
  if (!OBJECT_ID_RE.test(objectId)) throw new HttpError(400, 'BAD_OBJECT_ID');
  const found = findObjectPath(objectId);
  if (!found) throw new HttpError(404, `OBJECT_NOT_FOUND: ${objectId}`);
  const current = readJson(found.path) as Json;
  for (const [k, v] of Object.entries(set)) {
    if (k === 'id' || k === 'type') continue;
    current[k] = v;
  }
  for (const k of remove) {
    if (k === 'id' || k === 'type') continue;
    delete current[k];
  }
  writeFileSync(found.path, JSON.stringify(current, null, 2) + '\n', 'utf-8');
  return { objectId };
}

function deleteObjects(ids: string[]): { deletedCount: number; missing: string[] } {
  let deleted = 0;
  const missing: string[] = [];
  for (const id of ids) {
    const found = findObjectPath(id);
    if (!found) { missing.push(id); continue; }
    unlinkSync(found.path);
    deleted++;
  }
  return { deletedCount: deleted, missing };
}

function findObjects(params: {
  where?: Json;
  collection?: string;
  objectIds?: string[];
  order?: 'asc' | 'desc';
  limit?: number;
}): { objects: Json[]; count: number } {
  const where = params.where ?? {};
  const order = params.order ?? 'desc';
  const idScope = params.objectIds !== undefined ? new Set(params.objectIds) : null;
  const targets = params.collection ? [params.collection] : listCollections();
  const matches: Array<{ stamp: number; body: Json }> = [];
  for (const c of targets) {
    const dir = join(SPACE_ROOT, c);
    if (!existsSync(dir)) continue;
    for (const f of listObjectFiles(c)) {
      const id = f.slice(0, -'.json'.length);
      if (idScope && !idScope.has(id)) continue;
      let body: Json;
      try { body = readJson(join(dir, f)) as Json; } catch { continue; }
      const view = { ...body, id, type: c };
      let ok = true;
      for (const [k, v] of Object.entries(where)) {
        if ((view as Json)[k] !== v) { ok = false; break; }
      }
      if (!ok) continue;
      const stamp = readStamp(id).modifiedAt;
      matches.push({ stamp, body: view });
    }
  }
  matches.sort((a, b) => (order === 'desc' ? b.stamp - a.stamp : a.stamp - b.stamp));
  let out = matches;
  if (params.limit !== undefined && params.limit > 0) out = matches.slice(0, params.limit);
  return { objects: out.map((m) => m.body), count: out.length };
}

function createCollection(name: string, fields: unknown): { name: string; def: Json } {
  if (typeof name !== 'string' || !COLLECTION_NAME_RE.test(name)) {
    throw new HttpError(400, 'BAD_COLLECTION_NAME');
  }
  if (RESERVED_COLLECTION_NAMES.has(name)) throw new HttpError(400, `RESERVED_COLLECTION_NAME: ${name}`);
  const dir = join(SPACE_ROOT, name);
  if (existsSync(dir)) throw new HttpError(409, `COLLECTION_EXISTS: ${name}`);
  mkdirSync(dir);
  const def = { fields };
  writeFileSync(join(dir, SCHEMA_BASENAME), JSON.stringify(def, null, 2) + '\n', 'utf-8');
  return { name, def: def as Json };
}

function alterCollection(name: string, fields: unknown): { name: string; def: Json } {
  if (typeof name !== 'string' || !COLLECTION_NAME_RE.test(name)) {
    throw new HttpError(400, 'BAD_COLLECTION_NAME');
  }
  const dir = join(SPACE_ROOT, name);
  if (!existsSync(dir)) throw new HttpError(404, `COLLECTION_NOT_FOUND: ${name}`);
  const def = { fields };
  writeFileSync(join(dir, SCHEMA_BASENAME), JSON.stringify(def, null, 2) + '\n', 'utf-8');
  return { name, def: def as Json };
}

function dropCollection(name: string): { name: string } {
  if (typeof name !== 'string' || !COLLECTION_NAME_RE.test(name)) {
    throw new HttpError(400, 'BAD_COLLECTION_NAME');
  }
  const target = join(SPACE_ROOT, name, SCHEMA_BASENAME);
  if (!existsSync(target)) throw new HttpError(404, `COLLECTION_NOT_FOUND: ${name}`);
  unlinkSync(target);
  return { name };
}

function setMeta(meta: Json): Record<string, never> {
  writeFileSync(join(SPACE_ROOT, META_BASENAME), JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  return {};
}

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function handleSpaceRequest(
  method: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // rest = "v1/spaces/<id>/<resource>/..." — we ignore the spaceId since
  // /space serves exactly one space anyway.
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'v1' || parts[1] !== 'spaces') {
    sendJson(res, 404, { error: 'NOT_FOUND' });
    return;
  }
  const resource = parts[3];
  const tail = parts.slice(4);

  try {
    if (resource === 'overview' && method === 'GET' && tail.length === 0) {
      sendJson(res, 200, getOverview());
      return;
    }
    if (resource === 'objects') {
      if (method === 'GET' && tail.length === 1) {
        const obj = getObject(tail[0]);
        if (!obj) { sendJson(res, 404, { error: `OBJECT_NOT_FOUND: ${tail[0]}` }); return; }
        sendJson(res, 200, obj);
        return;
      }
      if (method === 'POST' && tail.length === 0) {
        const body = await readJsonBody(req);
        const data = body.data;
        if (!data || typeof data !== 'object') { sendJson(res, 400, { error: 'MISSING_DATA_OBJECT' }); return; }
        sendJson(res, 200, createObject(data as Json));
        return;
      }
      if (method === 'POST' && tail.length === 1 && tail[0] === '_delete') {
        const body = await readJsonBody(req);
        const ids = body.ids;
        if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
          sendJson(res, 400, { error: 'BAD_IDS_LIST' }); return;
        }
        sendJson(res, 200, deleteObjects(ids as string[]));
        return;
      }
      if (method === 'PATCH' && tail.length === 1) {
        const body = await readJsonBody(req);
        const set = (body.set as Json) ?? {};
        const remove = (body.remove as string[]) ?? [];
        sendJson(res, 200, updateObject(tail[0], set, remove));
        return;
      }
    }
    if (resource === 'find' && method === 'POST' && tail.length === 0) {
      const body = await readJsonBody(req);
      sendJson(res, 200, findObjects(body as never));
      return;
    }
    if (resource === 'schema') {
      if (method === 'POST' && tail.length === 0) {
        const body = await readJsonBody(req);
        sendJson(res, 200, createCollection(body.name as string, body.fields));
        return;
      }
      if (method === 'PUT' && tail.length === 1) {
        const body = await readJsonBody(req);
        sendJson(res, 200, alterCollection(tail[0], body.fields));
        return;
      }
      if (method === 'DELETE' && tail.length === 1) {
        sendJson(res, 200, dropCollection(tail[0]));
        return;
      }
    }
    if (resource === 'meta' && method === 'PUT' && tail.length === 0) {
      const body = await readJsonBody(req);
      const meta = body.meta;
      if (!meta || typeof meta !== 'object') { sendJson(res, 400, { error: 'META_MUST_BE_OBJECT' }); return; }
      sendJson(res, 200, setMeta(meta as Json));
      return;
    }
    sendJson(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
    else sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

// ----------------------------------------------------------------------
// Event stream — fs.watch /space, diff, push SSE frames.
// ----------------------------------------------------------------------

interface SpaceSnapshot {
  objects: Map<string, { collection: string; stamp: Stamp }>;
  schema: Json;
  meta: Json;
}

function takeSnapshot(): SpaceSnapshot {
  const objects = new Map<string, { collection: string; stamp: Stamp }>();
  const schema: Json = {};
  let meta: Json = {};
  for (const c of listCollections()) {
    const sp = join(SPACE_ROOT, c, SCHEMA_BASENAME);
    if (existsSync(sp)) {
      try { schema[c] = readJson(sp); } catch { /* skip */ }
    }
    for (const f of listObjectFiles(c)) {
      const id = f.slice(0, -'.json'.length);
      objects.set(id, { collection: c, stamp: readStamp(id) });
    }
  }
  const metaPath = join(SPACE_ROOT, META_BASENAME);
  if (existsSync(metaPath)) {
    try {
      const v = readJson(metaPath);
      if (v && typeof v === 'object') meta = v as Json;
    } catch { /* skip */ }
  }
  return { objects, schema, meta };
}

interface SseConn {
  res: ServerResponse;
}

function startEventLoop(onEvent: (frame: Json) => void): () => void {
  let last = takeSnapshot();
  let pending = false;
  const trigger = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const next = takeSnapshot();
      diff(last, next, onEvent);
      last = next;
    }, 50);
  };

  // fs.watch is recursive on Linux as of Node 20; the FUSE driver fires
  // invalidate_entry_async on commits, which Node surfaces here.
  const w = existsSync(SPACE_ROOT)
    ? watch(SPACE_ROOT, { recursive: true }, trigger)
    : null;

  // Also poll at low frequency as a backstop — recursive fs.watch on FUSE
  // mounts has been spotty historically.
  const poll = setInterval(trigger, 1000);

  return () => {
    w?.close();
    clearInterval(poll);
  };
}

function diff(prev: SpaceSnapshot, next: SpaceSnapshot, emit: (frame: Json) => void): void {
  for (const [id, info] of next.objects) {
    const before = prev.objects.get(id);
    if (!before || before.stamp.modifiedAt !== info.stamp.modifiedAt || before.collection !== info.collection) {
      // Read body — may have changed under us; on read failure, skip.
      const obj = getObject(id);
      if (!obj) continue;
      emit({
        type: 'objectChanged',
        objectId: id,
        collection: info.collection,
        object: obj,
        stat: info.stamp,
      });
    }
  }
  for (const id of prev.objects.keys()) {
    if (!next.objects.has(id)) {
      emit({ type: 'objectDeleted', objectId: id });
    }
  }
  if (JSON.stringify(prev.schema) !== JSON.stringify(next.schema)) {
    emit({ type: 'schemaChanged', schema: next.schema });
  }
  if (JSON.stringify(prev.meta) !== JSON.stringify(next.meta)) {
    emit({ type: 'metaChanged', meta: next.meta });
  }
}

function handleEventsSubscribe(res: ServerResponse, conns: Set<SseConn>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(': connected\n\n');
  const conn: SseConn = { res };
  conns.add(conn);
  res.on('close', () => { conns.delete(conn); });
}

function broadcast(conns: Set<SseConn>, frame: Json): void {
  const line = `data: ${JSON.stringify(frame)}\n\n`;
  for (const c of conns) {
    try { c.res.write(line); } catch { /* dropped */ }
  }
}

// ----------------------------------------------------------------------
// Request routing.
// ----------------------------------------------------------------------

function handleRequest(req: IncomingMessage, res: ServerResponse, opts: ServerOpts, conns: Set<SseConn>): void {
  const url = req.url ?? '/';
  const pathname = url.split('?')[0];

  try {
    if (pathname === HOST_PREFIX || pathname === `${HOST_PREFIX}/`) {
      const html = buildHostHtml(opts);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (pathname === `${HOST_PREFIX}/fs-host.js`) {
      const buf = readFileSync(FS_HOST_BUNDLE);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(buf);
      return;
    }
    if (pathname === `${SPACE_PREFIX}/events`) {
      handleEventsSubscribe(res, conns);
      return;
    }
    if (pathname.startsWith(`${SPACE_PREFIX}/`)) {
      const rest = pathname.slice(SPACE_PREFIX.length + 1);
      void handleSpaceRequest(req.method ?? 'GET', rest, req, res);
      return;
    }

    // Everything else is the extension served at /.
    const subPath = pathname === '/' ? 'index.html' : pathname;
    const target = safeJoin(opts.distDir, subPath);
    if (!target || !existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    serveDistFile(target, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(msg);
  }
}

export const PREVIEW_HOST_PATH = HOST_PREFIX;

async function startHttpServer(opts: ServerOpts, conns: Set<SseConn>): Promise<{ port: number; url: string; server: Server }> {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((req, res) => handleRequest(req, res, opts, conns));
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
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
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
  const extensionName = required('ROOL_PREVIEW_EXTENSION_NAME');
  const distDir = required('ROOL_PREVIEW_DIST_DIR');
  const width = Number(required('ROOL_PREVIEW_WIDTH'));
  const height = Number(required('ROOL_PREVIEW_HEIGHT'));

  ensureStateDir();

  if (!existsSync(distDir) || !existsSync(resolve(distDir, 'index.html'))) {
    fail(`No built extension at ${distDir} (run \`rool-extension build\` first).`);
  }
  if (!existsSync(FS_HOST_BUNDLE)) {
    fail(`Fs host bundle missing at ${FS_HOST_BUNDLE} — package build is incomplete.`);
  }
  if (!existsSync(SPACE_ROOT)) {
    fail(`Space root ${SPACE_ROOT} not found — preview only runs inside a sandbox VM.`);
  }

  // VM is named after its space id (sandbox.ts sets hostname). Fall back
  // to the extension id when the convention doesn't hold (e.g. dev).
  const spaceId = hostname() || extensionId;
  const spaceName = extensionName;

  const conns = new Set<SseConn>();
  const stopEvents = startEventLoop((frame) => broadcast(conns, frame));

  const { port: serverPort, server } = await startHttpServer({
    distDir,
    channelId: extensionId,
    spaceId,
    spaceName,
  }, conns);
  const hostUrl = `http://127.0.0.1:${serverPort}${HOST_PREFIX}/`;
  console.log(`[preview-daemon] http server listening on ${hostUrl}`);

  rmSync(USER_DATA_DIR, { recursive: true, force: true });
  mkdirSync(USER_DATA_DIR, { recursive: true });

  const chromium = await spawnChromium({
    userDataDir: USER_DATA_DIR,
    width,
    height,
    startUrl: hostUrl,
  });
  console.log(`[preview-daemon] chromium pid=${chromium.proc.pid} cdpPort=${chromium.cdpPort}`);

  const cdp = await CdpClient.connect(chromium.browserWsUrl);

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
    if (v?.error) fail(`Fs host bootstrap failed: ${v.error}`);
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
    pid: process.pid,
    serverPort,
    browserWsUrl: chromium.browserWsUrl,
    targetId: pageTarget.targetId,
    extensionId,
    extensionName,
    step: 0,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[preview-daemon] ready: ${STATE_FILE}`);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    stopEvents();
    try { rmSync(STATE_FILE, { force: true }); } catch { /* */ }
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

  await new Promise<void>(() => { /* never resolves */ });
}
