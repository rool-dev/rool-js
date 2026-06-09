import type { AuthManager } from './auth.js';

export type WebDAVPathInput = string;
export type WebDAVDepth = '0' | '1' | 'infinity';
export type WebDAVSyncLevel = '1' | 'infinite';
export type WebDAVLockDepth = '0' | 'infinity';

export type WebDAVPropName =
  | 'creationdate'
  | 'displayname'
  | 'getcontentlength'
  | 'getcontenttype'
  | 'getetag'
  | 'getlastmodified'
  | 'lockdiscovery'
  | 'quota-available-bytes'
  | 'quota-used-bytes'
  | 'resourcetype'
  | 'supportedlock'
  | 'current-user-privilege-set'
  | 'supported-report-set'
  | 'sync-token'
  | (string & {});

export interface WebDAVConfig {
  webdavUrl: string;
  spaceId: string;
  authManager: AuthManager;
  /** Called on shard refusal/drain (421/503). Return the new WebDAV base URL. */
  onRefused?: () => Promise<string>;
}

export interface SpaceFileStorageUsage {
  /** Bytes currently used by files in this space. */
  usedBytes: number;
  /** Bytes still available, or null when the plan has no storage limit. */
  availableBytes: number | null;
  /** Total storage limit, or null when the plan has no storage limit. */
  limitBytes: number | null;
}

export interface WebDAVRequestInit extends RequestInit {
  /** Treat the path as a collection URL, i.e. include the trailing slash. */
  collection?: boolean;
}

export interface WebDAVWriteResult {
  status: 200 | 201 | 204;
  etag: string | null;
  location: string | null;
}

export interface WebDAVLockResult {
  status: 200 | 201;
  token: string;
  timeoutSeconds: number | null;
  locks: WebDAVActiveLock[];
  xml: string;
}

export interface WebDAVMultiStatus {
  status: 207;
  xml: string;
  responses: WebDAVResponse[];
}

export interface WebDAVSyncCollectionResult extends WebDAVMultiStatus {
  token: string;
}

export interface WebDAVResponse {
  href: string;
  path: string;
  isCollection: boolean;
  status: number | null;
  props: WebDAVProps;
  propstats: WebDAVPropstat[];
}

export interface WebDAVPropstat {
  status: number;
  props: Record<string, unknown>;
}

export interface WebDAVProps {
  creationdate?: string;
  displayname?: string;
  getcontentlength?: number;
  getcontenttype?: string;
  getetag?: string;
  getlastmodified?: string;
  resourcetype?: 'collection' | '';
  quotaUsedBytes?: number;
  quotaAvailableBytes?: number | null;
  canWrite?: boolean;
  locks?: WebDAVActiveLock[];
  syncToken?: string;
  supportedReports?: string[];
  [key: string]: unknown;
}

export interface WebDAVActiveLock {
  token: string | null;
  owner: string | null;
  depth: WebDAVLockDepth | null;
  timeoutSeconds: number | null;
  root: string | null;
  scope: 'exclusive' | 'shared' | null;
  type: 'write' | null;
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const REQUEST_MAX_RETRIES = 6;
const RETRY_BASE_MS = 150;
const RETRY_MAX_MS = 5_000;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function retryBackoffMs(attempt: number): number {
  const ceil = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return ceil / 2 + Math.random() * (ceil / 2);
}
const KNOWN_PROPS = [
  'creationdate',
  'displayname',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'getlastmodified',
  'lockdiscovery',
  'quota-available-bytes',
  'quota-used-bytes',
  'resourcetype',
  'supportedlock',
  'current-user-privilege-set',
  'supported-report-set',
  'sync-token',
] as const;

export class WebDAVError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(response: Response, body: string) {
    super(`WebDAV request failed: ${response.status} ${response.statusText}`);
    this.name = 'WebDAVError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
  }
}

/** WebDAV client for a space's authenticated file storage. */
export class RoolWebDAV {
  private webdavUrl: string;
  private spaceId: string;
  private authManager: AuthManager;
  private onRefused?: () => Promise<string>;

  constructor(config: WebDAVConfig) {
    this.webdavUrl = normalizeWebDAVBaseUrl(config.webdavUrl);
    this.spaceId = config.spaceId;
    this.authManager = config.authManager;
    this.onRefused = config.onRefused;
  }

  /** Update the WebDAV base URL (used after shard rerouting). */
  setWebDAVUrl(webdavUrl: string): void {
    this.webdavUrl = normalizeWebDAVBaseUrl(webdavUrl);
  }

  /** Normalize a WebDAV path to a machine path. Relative paths resolve under /rool-drive. */
  path(path: WebDAVPathInput): string {
    const target = parseWebDAVPath(path);
    return target.root ? `/${target.root}${target.path ? `/${target.path}` : ''}` : '/';
  }

  /** Return the WebDAV href for a machine path or relative /rool-drive path. */
  href(path: WebDAVPathInput = '', options?: { collection?: boolean }): string {
    return this.pathUrl(path, options).href;
  }

  /** Return the absolute WebDAV URL for a root-relative path. */
  url(path: WebDAVPathInput = '', options?: { collection?: boolean }): string {
    const davPath = this.pathUrl(path, options);
    return `${this.webdavUrl}${davPath.href}`;
  }

  /** Low-level WebDAV request for a machine path or relative /rool-drive path. Adds Rool auth and returns the raw Response. */
  async request(method: string, path: WebDAVPathInput = '', init: WebDAVRequestInit = {}): Promise<Response> {
    const { collection, ...fetchInit } = init;
    const requestInit = { ...fetchInit, method };
    let response = await this.authenticatedFetch(this.url(path, { collection }), requestInit);

    // 421 (wrong shard) and 503 (draining) reject before executing server-side.
    // Re-resolve the owning shard and retry. This is safe for channel object
    // mutations; callers using one-shot ReadableStreams should avoid retries.
    for (
      let attempt = 0;
      (response.status === 421 || response.status === 503) && this.onRefused && attempt < REQUEST_MAX_RETRIES;
      attempt++
    ) {
      await delay(retryBackoffMs(attempt));
      try {
        this.setWebDAVUrl(await this.onRefused());
      } catch {
        continue;
      }
      response = await this.authenticatedFetch(this.url(path, { collection }), requestInit);
    }

    return response;
  }

  async options(path: WebDAVPathInput = ''): Promise<Response> {
    return this.request('OPTIONS', path);
  }

  async propfind(path: WebDAVPathInput, options: {
    depth: WebDAVDepth;
    props?: 'allprop' | 'propname' | WebDAVPropName[];
    signal?: AbortSignal;
  }): Promise<WebDAVMultiStatus> {
    const response = await this.request('PROPFIND', path, {
      collection: isCollectionInput(path),
      signal: options.signal,
      headers: {
        Depth: options.depth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: propfindXml(options.props),
    });
    await assertStatus(response, 207);

    const xml = await response.text();
    return parseMultiStatus(xml, this.spaceId);
  }

  async syncCollection(path: WebDAVPathInput, options: {
    token?: string | null;
    level: WebDAVSyncLevel;
    props?: 'allprop' | WebDAVPropName[];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<WebDAVSyncCollectionResult> {
    const response = await this.request('REPORT', path, {
      collection: true,
      signal: options.signal,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body: syncCollectionXml(options),
    });
    await assertStatus(response, 207);

    const xml = await response.text();
    const multistatus = parseMultiStatus(xml, this.spaceId);
    const token = textOf(xml, 'sync-token');
    if (!token) throw new Error('sync-collection response missing sync-token');
    return { ...multistatus, token };
  }

  /** Return WebDAV quota usage for this space. */
  async getStorageUsage(): Promise<SpaceFileStorageUsage> {
    const result = await this.propfind('', {
      depth: '0',
      props: ['quota-used-bytes', 'quota-available-bytes'],
    });
    const props = result.responses[0]?.props;
    const usedBytes = props?.quotaUsedBytes;
    if (typeof usedBytes !== 'number') {
      throw new Error('Storage usage response missing quota-used-bytes');
    }

    const availableBytes = typeof props?.quotaAvailableBytes === 'number'
      ? props.quotaAvailableBytes
      : null;

    return {
      usedBytes,
      availableBytes,
      limitBytes: availableBytes === null ? null : usedBytes + availableBytes,
    };
  }

  async get(path: WebDAVPathInput, options: {
    range?: string | { start: number; end?: number };
    signal?: AbortSignal;
  } = {}): Promise<Response> {
    const headers = new Headers();
    if (options.range) headers.set('Range', rangeHeader(options.range));
    const response = await this.request('GET', path, {
      signal: options.signal,
      headers,
    });
    await assertOk(response);
    return response;
  }

  async head(path: WebDAVPathInput): Promise<Response> {
    const response = await this.request('HEAD', path);
    await assertOk(response);
    return response;
  }

  async put(path: WebDAVPathInput, body: BodyInit, options: {
    contentType?: string;
    ifMatch?: string;
    ifNoneMatch?: string;
    lockToken?: string;
    signal?: AbortSignal;
    headers?: HeadersInit;
  } = {}): Promise<WebDAVWriteResult> {
    const headers = writeHeaders(options);
    if (options.contentType) headers.set('Content-Type', options.contentType);

    const response = await this.request('PUT', path, {
      signal: options.signal,
      headers,
      body,
    });
    await assertStatus(response, 200, 201, 204);
    return writeResult(response);
  }

  async delete(path: WebDAVPathInput, options: {
    ifMatch?: string;
    lockToken?: string;
    headers?: HeadersInit;
  } = {}): Promise<void> {
    const response = await this.request('DELETE', path, {
      collection: isCollectionInput(path),
      headers: writeHeaders(options),
    });
    await assertStatus(response, 204);
  }

  async mkcol(path: WebDAVPathInput, options: { lockToken?: string; headers?: HeadersInit } = {}): Promise<void> {
    const response = await this.request('MKCOL', path, {
      collection: true,
      headers: writeHeaders(options),
    });
    await assertStatus(response, 201);
  }

  async copy(source: WebDAVPathInput, destination: WebDAVPathInput, options: {
    depth?: '0' | 'infinity';
    overwrite?: boolean;
    lockToken?: string;
    headers?: HeadersInit;
  } = {}): Promise<WebDAVWriteResult> {
    const response = await this.moveOrCopy('COPY', source, destination, options);
    return writeResult(response);
  }

  async move(source: WebDAVPathInput, destination: WebDAVPathInput, options: {
    overwrite?: boolean;
    lockToken?: string;
    headers?: HeadersInit;
  } = {}): Promise<WebDAVWriteResult> {
    const response = await this.moveOrCopy('MOVE', source, destination, options);
    return writeResult(response);
  }

  async lock(path: WebDAVPathInput, options: {
    depth: WebDAVLockDepth;
    owner?: string;
    timeoutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<WebDAVLockResult> {
    const headers = new Headers({
      Depth: options.depth,
      'Content-Type': 'application/xml; charset=utf-8',
    });
    if (options.timeoutSeconds) headers.set('Timeout', `Second-${options.timeoutSeconds}`);

    const response = await this.request('LOCK', path, {
      collection: isCollectionInput(path),
      signal: options.signal,
      headers,
      body: lockXml(options.owner ?? ''),
    });
    await assertStatus(response, 200, 201);
    return lockResult(response, await response.text());
  }

  async refreshLock(path: WebDAVPathInput, token: string, options: {
    timeoutSeconds?: number;
    signal?: AbortSignal;
  } = {}): Promise<WebDAVLockResult> {
    const headers = new Headers({ If: `(<${token}>)` });
    if (options.timeoutSeconds) headers.set('Timeout', `Second-${options.timeoutSeconds}`);

    const response = await this.request('LOCK', path, {
      collection: isCollectionInput(path),
      signal: options.signal,
      headers,
    });
    await assertStatus(response, 200);
    return lockResult(response, await response.text());
  }

  async unlock(token: string): Promise<void> {
    const response = await this.request('UNLOCK', '', {
      collection: true,
      headers: { 'Lock-Token': `<${token}>` },
    });
    await assertStatus(response, 204);
  }

  private async moveOrCopy(method: 'MOVE' | 'COPY', source: WebDAVPathInput, destination: WebDAVPathInput, options: {
    depth?: '0' | 'infinity';
    overwrite?: boolean;
    lockToken?: string;
    headers?: HeadersInit;
  }): Promise<Response> {
    const headers = writeHeaders(options);
    headers.set('Destination', this.url(destination, { collection: isCollectionInput(destination) }));
    if (options.overwrite !== undefined) headers.set('Overwrite', options.overwrite ? 'T' : 'F');
    if (method === 'COPY' && options.depth) headers.set('Depth', options.depth);

    const response = await this.request(method, source, {
      collection: isCollectionInput(source),
      headers,
    });
    await assertStatus(response, 201, 204);
    return response;
  }

  private async authenticatedFetch(url: string, init: RequestInit): Promise<Response> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    headers.set('X-Rool-Token', tokens.roolToken);

    const requestInit: RequestInit & { duplex?: 'half' } = { ...init, headers };
    if (typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream) {
      requestInit.duplex = 'half';
    }

    return fetch(url, requestInit);
  }

  private pathUrl(path: WebDAVPathInput, options?: { collection?: boolean }): { href: string; path: string; isCollection: boolean } {
    const isCollection = options?.collection ?? isCollectionInput(path);
    const target = parseWebDAVPath(path);
    const encodedSpace = encodeURIComponent(this.spaceId);
    const encodedPath = target.path
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    const suffix = encodedPath ? `/${encodedPath}` : '';
    const root = target.root ? `/${target.root}` : '';
    return {
      href: `/space/${encodedSpace}${root}${suffix}${isCollection ? '/' : ''}`,
      path: target.path,
      isCollection,
    };
  }
}

function isCollectionInput(path: WebDAVPathInput): boolean {
  return path === '' || path.endsWith('/');
}

function normalizeWebDAVBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/dav$/, '');
}

function parseWebDAVPath(path: WebDAVPathInput): { root: 'rool-drive' | 'space' | ''; path: string } {
  if (path.includes('\\')) throw new Error('Invalid WebDAV path');
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error('Invalid WebDAV path');
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid WebDAV path');

  if (path === '/') return { root: '', path: '' };
  const normalized = path.replace(/\/+$/, '');
  if (normalized === '') return { root: 'rool-drive', path: '' };

  if (normalized === '/rool-drive') return { root: 'rool-drive', path: '' };
  if (normalized.startsWith('/rool-drive/')) {
    return { root: 'rool-drive', path: validateRelativeWebDAVPath(normalized.slice('/rool-drive/'.length)) };
  }

  if (normalized === '/space') return { root: 'space', path: '' };
  if (normalized.startsWith('/space/')) {
    return { root: 'space', path: validateRelativeWebDAVPath(normalized.slice('/space/'.length)) };
  }

  if (normalized.startsWith('/')) throw new Error('Invalid WebDAV path');
  return { root: 'rool-drive', path: validateRelativeWebDAVPath(normalized) };
}

function validateRelativeWebDAVPath(path: string): string {
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('Invalid WebDAV path');
  }
  return path;
}

function rangeHeader(range: string | { start: number; end?: number }): string {
  if (typeof range === 'string') return range;
  if (!Number.isSafeInteger(range.start) || range.start < 0) throw new Error('Invalid range start');
  if (range.end === undefined) return `bytes=${range.start}-`;
  if (!Number.isSafeInteger(range.end) || range.end < range.start) throw new Error('Invalid range end');
  return `bytes=${range.start}-${range.end}`;
}

function writeHeaders(options: {
  ifMatch?: string;
  ifNoneMatch?: string;
  lockToken?: string;
  headers?: HeadersInit;
}): Headers {
  const headers = new Headers(options.headers);
  if (options.ifMatch) headers.set('If-Match', options.ifMatch);
  if (options.ifNoneMatch) headers.set('If-None-Match', options.ifNoneMatch);
  if (options.lockToken) headers.set('If', `(<${options.lockToken}>)`);
  return headers;
}

function propfindXml(props: 'allprop' | 'propname' | WebDAVPropName[] | undefined): string {
  if (!props || props === 'allprop') {
    return `${XML_HEADER}<d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`;
  }
  if (props === 'propname') {
    return `${XML_HEADER}<d:propfind xmlns:d="DAV:"><d:propname/></d:propfind>`;
  }

  const names = props.map((name) => `<d:${name}/>`).join('');
  return `${XML_HEADER}<d:propfind xmlns:d="DAV:"><d:prop>${names}</d:prop></d:propfind>`;
}

function syncCollectionXml(options: {
  token?: string | null;
  level: WebDAVSyncLevel;
  props?: 'allprop' | WebDAVPropName[];
  limit?: number;
}): string {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) {
    throw new Error('Invalid sync-collection limit');
  }

  const token = `<d:sync-token>${xmlEscape(options.token ?? '')}</d:sync-token>`;
  const level = `<d:sync-level>${options.level}</d:sync-level>`;
  const props = !options.props || options.props === 'allprop'
    ? '<d:prop><d:displayname/><d:getcontentlength/><d:getcontenttype/><d:getetag/><d:getlastmodified/><d:resourcetype/></d:prop>'
    : `<d:prop>${options.props.map((name) => `<d:${name}/>`).join('')}</d:prop>`;
  const limit = options.limit ? `<d:limit><d:nresults>${options.limit}</d:nresults></d:limit>` : '';
  return `${XML_HEADER}<d:sync-collection xmlns:d="DAV:">${token}${level}${props}${limit}</d:sync-collection>`;
}

function lockXml(owner: string): string {
  return `${XML_HEADER}<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner>${xmlEscape(owner)}</d:owner></d:lockinfo>`;
}

function writeResult(response: Response): WebDAVWriteResult {
  return {
    status: response.status as 200 | 201 | 204,
    etag: response.headers.get('ETag'),
    location: response.headers.get('Location'),
  };
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new WebDAVError(response, await response.text());
}

async function assertStatus(response: Response, ...statuses: number[]): Promise<void> {
  if (statuses.includes(response.status)) return;
  throw new WebDAVError(response, await response.text());
}

function lockResult(response: Response, xml: string): WebDAVLockResult {
  const locks = parseActiveLocks(xml);
  const headerToken = response.headers.get('Lock-Token')?.match(/<([^>]+)>/)?.[1] ?? null;
  const token = locks[0]?.token ?? headerToken;
  if (!token) throw new Error('LOCK response missing lock token');

  return {
    status: response.status as 200 | 201,
    token,
    timeoutSeconds: locks[0]?.timeoutSeconds ?? parseTimeout(response.headers.get('Timeout')),
    locks,
    xml,
  };
}

function parseMultiStatus(xml: string, spaceId: string): WebDAVMultiStatus {
  const responses = blocks(xml, 'response').map((responseXml) => parseResponse(responseXml, spaceId));
  return { status: 207, xml, responses };
}

function parseResponse(xml: string, spaceId: string): WebDAVResponse {
  const href = textOf(xml, 'href') ?? '';
  const propstats = blocks(xml, 'propstat').map(parsePropstat);
  const okProps = propstats.find((propstat) => propstat.status === 200)?.props ?? {};
  const props = toWebDAVProps(okProps);
  const isCollection = props.resourcetype === 'collection' || href.endsWith('/');

  return {
    href,
    path: pathFromHref(href, spaceId),
    isCollection,
    status: statusCode(textOf(xml, 'status')),
    props,
    propstats,
  };
}

function parsePropstat(xml: string): WebDAVPropstat {
  const propXml = block(xml, 'prop') ?? '';
  const props: Record<string, unknown> = {};

  for (const name of KNOWN_PROPS) {
    const raw = block(propXml, name) ?? selfClosing(propXml, name);
    if (raw !== null) props[name] = parsePropValue(name, raw);
  }

  return {
    status: statusCode(textOf(xml, 'status')) ?? 0,
    props,
  };
}

function parsePropValue(name: string, raw: string): unknown {
  if (name === 'getcontentlength' || name === 'quota-used-bytes' || name === 'quota-available-bytes') {
    const value = Number(stripTags(raw));
    return Number.isFinite(value) ? value : null;
  }
  if (name === 'resourcetype') return hasTag(raw, 'collection') ? 'collection' : '';
  if (name === 'lockdiscovery') return parseActiveLocks(raw);
  if (name === 'current-user-privilege-set') return { canWrite: hasTag(raw, 'write') || hasTag(raw, 'bind') };
  if (name === 'supportedlock') return { write: hasTag(raw, 'write') };
  if (name === 'supported-report-set') return { reports: hasTag(raw, 'sync-collection') ? ['sync-collection'] : [] };
  return xmlUnescape(stripTags(raw));
}

function toWebDAVProps(raw: Record<string, unknown>): WebDAVProps {
  const props: WebDAVProps = { ...raw };

  if (typeof raw['quota-used-bytes'] === 'number') props.quotaUsedBytes = raw['quota-used-bytes'];
  if (typeof raw['quota-available-bytes'] === 'number' || raw['quota-available-bytes'] === null) {
    props.quotaAvailableBytes = raw['quota-available-bytes'] as number | null;
  }
  if (Array.isArray(raw.lockdiscovery)) props.locks = raw.lockdiscovery as WebDAVActiveLock[];
  if (typeof raw['sync-token'] === 'string') props.syncToken = raw['sync-token'];
  const supportedReports = raw['supported-report-set'] as { reports?: string[] } | undefined;
  if (supportedReports?.reports) props.supportedReports = supportedReports.reports;
  const privileges = raw['current-user-privilege-set'] as { canWrite?: boolean } | undefined;
  if (privileges) props.canWrite = !!privileges.canWrite;

  return props;
}

function parseActiveLocks(xml: string): WebDAVActiveLock[] {
  return blocks(xml, 'activelock').map((activeLock) => ({
    token: block(activeLock, 'locktoken') ? textOf(block(activeLock, 'locktoken') ?? '', 'href') : null,
    owner: textOf(activeLock, 'owner'),
    depth: parseLockDepth(stripTags(block(activeLock, 'depth') ?? '')),
    timeoutSeconds: parseTimeout(stripTags(block(activeLock, 'timeout') ?? '')),
    root: block(activeLock, 'lockroot') ? textOf(block(activeLock, 'lockroot') ?? '', 'href') : null,
    scope: hasTag(block(activeLock, 'lockscope') ?? '', 'exclusive') ? 'exclusive' : hasTag(block(activeLock, 'lockscope') ?? '', 'shared') ? 'shared' : null,
    type: hasTag(block(activeLock, 'locktype') ?? '', 'write') ? 'write' : null,
  }));
}

function parseLockDepth(value: string): WebDAVLockDepth | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '0' || normalized === 'infinity') return normalized;
  return null;
}

function parseTimeout(value: string | null): number | null {
  const match = value?.match(/Second-(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function pathFromHref(href: string, spaceId: string): string {
  try {
    const pathname = new URL(href, 'http://rool.local').pathname;
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'space' && parts[1] === spaceId) {
      const root = parts[2];
      if (root === 'space') return `/space${parts.length > 3 ? `/${parts.slice(3).join('/')}` : ''}`;
      if (root === 'rool-drive') return `/rool-drive${parts.length > 3 ? `/${parts.slice(3).join('/')}` : ''}`;
      return '/';
    }
    if (parts[0] === 'dav' && parts[1] === spaceId) return parts.slice(2).join('/');
    return href;
  } catch {
    return href;
  }
}

function blocks(xml: string, name: string): string[] {
  const re = tagRe(name, 'g');
  const matches: string[] = [];
  for (const match of xml.matchAll(re)) matches.push(match[1]);
  return matches;
}

function block(xml: string, name: string): string | null {
  return tagRe(name).exec(xml)?.[1] ?? null;
}

function selfClosing(xml: string, name: string): string | null {
  return selfClosingRe(name).test(xml) ? '' : null;
}

function textOf(xml: string, name: string): string | null {
  const value = block(xml, name);
  return value === null ? null : xmlUnescape(stripTags(value));
}

function hasTag(xml: string, name: string): boolean {
  return tagRe(name).test(xml) || selfClosingRe(name).test(xml);
}

function tagRe(name: string, flags = ''): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9_]+:)?${escapeRe(name)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${escapeRe(name)}>`, flags);
}

function selfClosingRe(name: string): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9_]+:)?${escapeRe(name)}\\b[^>]*/>`);
}

function statusCode(status: string | null): number | null {
  const match = status?.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
