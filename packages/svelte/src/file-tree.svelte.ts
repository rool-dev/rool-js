import {
  isObjectPath,
  machinePath,
  type RoolSpace,
  type WebDAVDepth,
  type WebDAVPropName,
  type WebDAVResponse,
  type WebDAVSyncLevel,
} from '@rool-dev/sdk';

export type ReactiveFilePath = string;
export type ReactiveFileRoot = '' | 'space' | 'rool-drive';

export interface ReactiveFileNode {
  /** Stable node id. Same as `path`. */
  id: ReactiveFilePath;
  /** Machine/WebDAV path (`/`, `/space/...`, `/rool-drive/...`). */
  path: ReactiveFilePath;
  /** Parent path, or `null` for `/`. */
  parent: ReactiveFilePath | null;
  /** Last path segment, decoded by the server when available. */
  name: string;
  /** Which top-level filesystem this node belongs to. `/` has `root: ''`. */
  root: ReactiveFileRoot;
  isCollection: boolean;
  size: number | null;
  contentType: string | null;
  etag: string | null;
  modifiedAt: number | null;
  href: string | null;
}

export interface ReactiveFileTreeEvent {
  /** `true` when the tree was replaced from a full snapshot. */
  reset: boolean;
  changedPaths: Set<ReactiveFilePath>;
  deletedPaths: Set<ReactiveFilePath>;
  token: string | null;
}

export interface ReactiveFileTreeSyncResult extends ReactiveFileTreeEvent {
  changed: boolean;
}

export interface ReactiveFileTreeTransport {
  propfind(path: string, options: { depth: WebDAVDepth; props?: WebDAVPropName[]; signal?: AbortSignal }): Promise<{ responses: WebDAVResponse[] }>;
  syncCollection(path: string, options: { token?: string | null; level: WebDAVSyncLevel; props?: WebDAVPropName[]; limit?: number; signal?: AbortSignal }): Promise<{ token: string; responses: WebDAVResponse[] }>;
}

const ROOT = '/' as const;
const DEFAULT_PROPS = [
  'displayname',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'getlastmodified',
  'resourcetype',
] as const satisfies WebDAVPropName[];

type Listener = (event: ReactiveFileTreeEvent) => void;

function normalizePath(path: string): ReactiveFilePath {
  return machinePath(path);
}

function parentPath(path: ReactiveFilePath): ReactiveFilePath | null {
  if (path === ROOT) return null;
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? ROOT : (`/${parts.join('/')}` as ReactiveFilePath);
}

function leafName(path: ReactiveFilePath): string {
  if (path === ROOT) return 'Space';
  const leaf = path.split('/').filter(Boolean).pop() ?? '';
  try { return decodeURIComponent(leaf); } catch { return leaf; }
}

function rootOf(path: ReactiveFilePath): ReactiveFileRoot {
  if (path === ROOT) return '';
  if (path === '/space' || path.startsWith('/space/')) return 'space';
  if (path === '/rool-drive' || path.startsWith('/rool-drive/')) return 'rool-drive';
  return '';
}

function modifiedAt(props: WebDAVResponse['props']): number | null {
  const raw = props.getlastmodified;
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function nodeFromResponse(response: WebDAVResponse): ReactiveFileNode {
  const path = normalizePath(response.path);
  return {
    id: path,
    path,
    parent: parentPath(path),
    name: typeof response.props.displayname === 'string' && response.props.displayname
      ? response.props.displayname
      : leafName(path),
    root: rootOf(path),
    isCollection: response.isCollection,
    size: typeof response.props.getcontentlength === 'number' ? response.props.getcontentlength : null,
    contentType: typeof response.props.getcontenttype === 'string' ? response.props.getcontenttype : null,
    etag: typeof response.props.getetag === 'string' ? response.props.getetag : null,
    modifiedAt: modifiedAt(response.props),
    href: response.href || null,
  };
}

function isDeletedResponse(response: WebDAVResponse): boolean {
  if (response.status === 404 || response.status === 410) return true;
  return response.propstats.length > 0 && response.propstats.every((p) => p.status === 404 || p.status === 410);
}

function sameNode(a: ReactiveFileNode, b: ReactiveFileNode): boolean {
  return a.id === b.id
    && a.path === b.path
    && a.parent === b.parent
    && a.name === b.name
    && a.root === b.root
    && a.isCollection === b.isCollection
    && a.size === b.size
    && a.contentType === b.contentType
    && a.etag === b.etag
    && a.modifiedAt === b.modifiedAt
    && a.href === b.href;
}

function sortNodes(a: ReactiveFileNode, b: ReactiveFileNode): number {
  return Number(b.isCollection) - Number(a.isCollection) || a.name.localeCompare(b.name);
}

function emptyEvent(token: string | null, reset = false): ReactiveFileTreeEvent {
  return { reset, changedPaths: new Set(), deletedPaths: new Set(), token };
}

/**
 * Canonical Svelte-owned tree for the whole per-space WebDAV filesystem.
 *
 * It watches the SDK's coarse `filesChanged` / `filesReset` events and
 * reconciles with WebDAV `sync-collection`. Consumers that care about both
 * object files (`/space/...`) and user files (`/rool-drive/...`) should depend
 * on this tree.
 */
export class ReactiveFileTree {
  #space: RoolSpace;
  #nodes = new Map<ReactiveFilePath, ReactiveFileNode>();
  #children = new Map<ReactiveFilePath, ReactiveFilePath[]>();
  #listeners = new Set<Listener>();
  #unsubscribers: (() => void)[] = [];
  #syncing: Promise<ReactiveFileTreeSyncResult> | null = null;
  #initialLoad: Promise<void> | null = null;
  #syncAgain = false;
  #closed = false;

  nodes = $state<ReactiveFileNode[]>([]);
  byPath = $state<Record<string, ReactiveFileNode>>({});
  token = $state<string | null>(null);
  version = $state(0);
  loading = $state(true);
  syncing = $state(false);
  error = $state<Error | null>(null);

  constructor(space: RoolSpace) {
    this.#space = space;
    this.#setNode(rootNode());
    this.#publishState();
    this.#setupSpaceListeners();
    this.#initialLoad = this.loadSnapshot().then(() => undefined, () => undefined);
  }

  get isClosed(): boolean { return this.#closed; }
  get root(): ReactiveFilePath { return ROOT; }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  ready(): Promise<void> {
    return this.#initialLoad ?? Promise.resolve();
  }

  get(path: string): ReactiveFileNode | undefined {
    return this.#nodes.get(normalizePath(path));
  }

  has(path: string): boolean {
    return this.#nodes.has(normalizePath(path));
  }

  childrenOf(path: string): ReactiveFileNode[] {
    return (this.#children.get(normalizePath(path)) ?? [])
      .map((child) => this.#nodes.get(child))
      .filter((node): node is ReactiveFileNode => !!node);
  }

  descendantsOf(path: string): ReactiveFileNode[] {
    const root = normalizePath(path);
    return this.nodes.filter((node) => node.path !== root && isDescendant(node.path, root));
  }

  /** Object file paths sorted by modified time descending. */
  objectPaths(options: { collection?: string; order?: 'asc' | 'desc'; limit?: number } = {}): string[] {
    const paths = this.nodes
      .filter((node) => !node.isCollection && isObjectPath(node.path))
      .filter((node) => !options.collection || safeCollection(node.path) === options.collection)
      .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
      .map((node) => node.path);
    if (options.order === 'asc') paths.reverse();
    return options.limit === undefined ? paths : paths.slice(0, options.limit);
  }

  collections(): string[] {
    return this.childrenOf('/space')
      .filter((node) => node.isCollection)
      .map((node) => node.name)
      .sort((a, b) => a.localeCompare(b));
  }

  async loadSnapshot(): Promise<ReactiveFileTreeSyncResult> {
    if (this.#closed) return { changed: false, ...emptyEvent(this.token, true) };
    this.loading = true;
    this.error = null;
    try {
      let snapshot: { token: string | null; responses: WebDAVResponse[] };
      try {
        snapshot = await this.#space.webdav.syncCollection('/', { token: null, level: 'infinite', props: [...DEFAULT_PROPS] });
      } catch {
        const [listing, tokenListing] = await Promise.all([
          this.#space.webdav.propfind('/', { depth: 'infinity', props: [...DEFAULT_PROPS] }),
          this.#space.webdav.propfind('/', { depth: '0', props: ['sync-token'] }),
        ]);
        snapshot = {
          token: tokenListing.responses[0]?.props.syncToken ?? null,
          responses: listing.responses,
        };
      }

      this.token = snapshot.token;
      const result = this.#replaceSnapshot(snapshot.responses);
      const event = { reset: true, changedPaths: result.changedPaths, deletedPaths: result.deletedPaths, token: this.token };
      this.#emit(event);
      return { changed: result.changed, ...event };
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async sync(): Promise<ReactiveFileTreeSyncResult> {
    if (this.#closed) return { changed: false, ...emptyEvent(this.token) };
    if (this.#syncing) {
      this.#syncAgain = true;
      return this.#syncing;
    }

    this.syncing = true;
    this.error = null;
    this.#syncing = this.#syncOnce();
    try {
      const result = await this.#syncing;
      return result;
    } finally {
      this.#syncing = null;
      this.syncing = false;
      if (this.#syncAgain && !this.#closed) {
        this.#syncAgain = false;
        void this.sync();
      }
    }
  }

  refresh(): Promise<ReactiveFileTreeSyncResult> {
    return this.loadSnapshot();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    this.#listeners.clear();
  }

  #setupSpaceListeners(): void {
    const onFilesChanged = () => { void this.sync(); };
    const onFilesReset = () => { void this.loadSnapshot(); };
    const onConnectionStateChanged = (state: unknown) => {
      if (state === 'connected' && !this.loading) void this.sync();
    };

    this.#space.on('filesChanged', onFilesChanged);
    this.#space.on('filesReset', onFilesReset);
    this.#space.on('connectionStateChanged', onConnectionStateChanged as never);
    this.#unsubscribers.push(() => this.#space.off('filesChanged', onFilesChanged));
    this.#unsubscribers.push(() => this.#space.off('filesReset', onFilesReset));
    this.#unsubscribers.push(() => this.#space.off('connectionStateChanged', onConnectionStateChanged as never));
  }

  async #syncOnce(): Promise<ReactiveFileTreeSyncResult> {
    try {
      const delta = await this.#space.webdav.syncCollection('/', { token: this.token, level: 'infinite', props: [...DEFAULT_PROPS] });
      this.token = delta.token;
      const result = this.#applyResponses(delta.responses);
      const event = { reset: false, changedPaths: result.changedPaths, deletedPaths: result.deletedPaths, token: this.token };
      if (result.changed || event.deletedPaths.size > 0) this.#emit(event);
      return { changed: result.changed, ...event };
    } catch {
      return this.loadSnapshot();
    }
  }

  #replaceSnapshot(responses: readonly WebDAVResponse[]): { changed: boolean; changedPaths: Set<ReactiveFilePath>; deletedPaths: Set<ReactiveFilePath> } {
    const next = new Map<ReactiveFilePath, ReactiveFileNode>();
    next.set(ROOT, rootNode());

    for (const response of responses) {
      if (isDeletedResponse(response)) continue;
      const node = nodeFromResponse(response);
      next.set(node.path, node);
    }

    // Ensure aggregate roots exist even if a server/proxy omits them.
    if (!next.has('/space')) next.set('/space', syntheticRootChild('/space', 'space'));
    if (!next.has('/rool-drive')) next.set('/rool-drive', syntheticRootChild('/rool-drive', 'rool-drive'));

    const changedPaths = new Set<ReactiveFilePath>();
    const deletedPaths = new Set<ReactiveFilePath>();
    for (const [path, node] of next) {
      const old = this.#nodes.get(path);
      if (!old || !sameNode(old, node)) changedPaths.add(path);
    }
    for (const path of this.#nodes.keys()) {
      if (!next.has(path)) deletedPaths.add(path);
    }

    this.#nodes = next;
    this.#rebuildChildren();
    const changed = changedPaths.size > 0 || deletedPaths.size > 0;
    if (changed) this.#publishState();
    return { changed, changedPaths, deletedPaths };
  }

  #applyResponses(responses: readonly WebDAVResponse[]): { changed: boolean; changedPaths: Set<ReactiveFilePath>; deletedPaths: Set<ReactiveFilePath> } {
    let changed = false;
    const changedPaths = new Set<ReactiveFilePath>();
    const deletedPaths = new Set<ReactiveFilePath>();

    for (const response of responses) {
      const path = normalizePath(response.path);
      if (path === ROOT) continue;

      if (isDeletedResponse(response)) {
        if (this.#deleteSubtree(path, deletedPaths)) changed = true;
        else deletedPaths.add(path);
        continue;
      }

      const node = nodeFromResponse(response);
      const old = this.#nodes.get(node.path);
      if (!old || !sameNode(old, node)) {
        this.#setNode(node);
        changed = true;
        changedPaths.add(node.path);
      }
    }

    if (changed) {
      this.#rebuildChildren();
      this.#publishState();
    }
    return { changed, changedPaths, deletedPaths };
  }

  #setNode(node: ReactiveFileNode): void {
    this.#nodes.set(node.path, node);
  }

  #deleteSubtree(path: ReactiveFilePath, deletedPaths: Set<ReactiveFilePath>): boolean {
    let deleted = false;
    for (const nodePath of [...this.#nodes.keys()].sort((a, b) => b.length - a.length)) {
      if (nodePath === path || isDescendant(nodePath, path)) {
        this.#nodes.delete(nodePath);
        deletedPaths.add(nodePath);
        deleted = true;
      }
    }
    return deleted;
  }

  #rebuildChildren(): void {
    this.#children = new Map();
    for (const node of this.#nodes.values()) {
      if (!node.parent) continue;
      const bucket = this.#children.get(node.parent) ?? [];
      bucket.push(node.path);
      this.#children.set(node.parent, bucket);
    }
    for (const [parent, children] of this.#children) {
      children.sort((a, b) => sortNodes(this.#nodes.get(a)!, this.#nodes.get(b)!));
      this.#children.set(parent, children);
    }
  }

  #publishState(): void {
    const nodes = [...this.#nodes.values()].sort((a, b) => a.path === ROOT ? -1 : b.path === ROOT ? 1 : a.path.localeCompare(b.path));
    this.nodes = nodes;
    this.byPath = Object.fromEntries(nodes.map((node) => [node.path, node]));
    this.version += 1;
  }

  #emit(event: ReactiveFileTreeEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function rootNode(): ReactiveFileNode {
  return {
    id: ROOT,
    path: ROOT,
    parent: null,
    name: 'Space',
    root: '',
    isCollection: true,
    size: null,
    contentType: null,
    etag: null,
    modifiedAt: null,
    href: null,
  };
}

function syntheticRootChild(path: '/space' | '/rool-drive', name: 'space' | 'rool-drive'): ReactiveFileNode {
  return {
    id: path,
    path,
    parent: ROOT,
    name,
    root: name,
    isCollection: true,
    size: null,
    contentType: null,
    etag: null,
    modifiedAt: null,
    href: null,
  };
}

function isDescendant(path: ReactiveFilePath, ancestor: ReactiveFilePath): boolean {
  if (ancestor === ROOT) return path !== ROOT;
  return path.startsWith(`${ancestor}/`);
}

function safeCollection(path: string): string | undefined {
  if (!isObjectPath(path)) return undefined;
  return path.split('/')[2];
}
