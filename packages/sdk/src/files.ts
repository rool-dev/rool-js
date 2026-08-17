export type MachineFilePath =
  "/space" | `/space/${string}` | "/rool-drive" | `/rool-drive/${string}`;
export type MachineFileRange =
  { start: number; end?: number } | { suffixLength: number };

export type MachineFileAccessAudience =
  "resource-owner" | "machine-admins" | "machine-editors" | "machine-members";

export interface MachineFileAccess {
  currentUser: { read: boolean; write: boolean };
  readableBy: MachineFileAccessAudience[];
  writableBy: MachineFileAccessAudience[];
}

interface MachineFileInfoBase {
  path: MachineFilePath;
  name: string;
  etag: string;
  createdAt: string;
  lastModified: string;
  ownerId?: string;
  access: MachineFileAccess;
}

export type MachineFileInfo =
  | (MachineFileInfoBase & {
      kind: "file";
      size: number;
      contentType: string;
    })
  | (MachineFileInfoBase & { kind: "directory" });

export interface MachineFileCapabilities {
  methods: string[];
  acceptsRanges: boolean;
  createsParents: boolean;
  readsMultiple: boolean;
  synchronizes: boolean;
  /** Maximum PUT body size for the path's storage root, or null when no single root applies. */
  maxUploadBytes: number | null;
}

export interface MachineStorageUsage {
  usedBytes: number;
  availableBytes: number;
}

export interface MachineFileReadOptions {
  range?: MachineFileRange;
  ifMatch?: string;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  ifUnmodifiedSince?: string;
  ifRange?: string;
  signal?: AbortSignal;
}

export interface MachineFileReadMultipleOptions {
  signal?: AbortSignal;
}

export type MachineFileReadResult =
  | {
      ok: true;
      path: MachineFilePath;
      status: 200;
      etag: string;
      contentType: string;
      size: number;
      body: Uint8Array;
    }
  | {
      ok: false;
      path: MachineFilePath;
      status: number;
    };

export interface MachineFileUploadProgress {
  transferredBytes: number;
  totalBytes?: number;
}

export type MachineFileWriteBody =
  BodyInit | (() => ReadableStream<Uint8Array>);

export type MachineFileRequestInit = Omit<RequestInit, "body"> & {
  body?: MachineFileWriteBody | null;
};

export interface MachineFileWriteOptions {
  contentType?: string;
  createParents?: boolean | "private";
  ifMatch?: string;
  ifNoneMatch?: string;
  ifUnmodifiedSince?: string;
  onUploadProgress?: (progress: MachineFileUploadProgress) => void;
  signal?: AbortSignal;
}

export interface MachineFileDeleteOptions {
  ifMatch?: string;
  ifNoneMatch?: string;
  ifUnmodifiedSince?: string;
  signal?: AbortSignal;
}

export interface MachineFileDeleteTarget<
  Path extends MachineFilePath = MachineFilePath,
> {
  path: Path;
  ifMatch?: string;
  ifNoneMatch?: string;
  ifUnmodifiedSince?: string;
}

export interface MachineFileDeleteMultipleOptions {
  signal?: AbortSignal;
}

export type MachineFileDeleteResult<
  Path extends MachineFilePath = MachineFilePath,
> = { ok: true; path: Path } | { ok: false; path: Path; error: unknown };

export interface MachineFileListOptions {
  recursive?: boolean;
  signal?: AbortSignal;
}

export interface MachineDirectoryCreateOptions {
  signal?: AbortSignal;
}

export interface MachineFileTransferOptions {
  overwrite?: boolean;
  ifMatch?: string;
  ifNoneMatch?: string;
  ifUnmodifiedSince?: string;
  signal?: AbortSignal;
}

export interface MachineFileCopyOptions extends MachineFileTransferOptions {
  recursive?: boolean;
}

export interface MachineFileTransferResult {
  source: MachineFilePath;
  destination: MachineFilePath;
  overwritten: boolean;
}

export interface MachineFileTreeChange {
  reset: boolean;
  changed: MachineFilePath[];
  deleted: MachineFilePath[];
}

export interface MachineFileTreeListOptions {
  recursive?: boolean;
}

export interface MachineFileTree {
  get(path: MachineFilePath): MachineFileInfo | undefined;
  etag(path: MachineFilePath): string | undefined;
  list(
    path?: MachineFilePath,
    options?: MachineFileTreeListOptions,
  ): MachineFileInfo[];
  subscribe(listener: (change: MachineFileTreeChange) => void): () => void;
}

export interface MachineFiles {
  readonly tree: MachineFileTree;
  readonly isWatching: boolean;
  readonly watchError: unknown;
  watch(): Promise<void>;
  unwatch(): void;
  href(path?: MachineFilePath): string;
  options(path?: MachineFilePath): Promise<MachineFileCapabilities>;
  getStorageUsage(signal?: AbortSignal): Promise<MachineStorageUsage>;
  read(
    path: MachineFilePath,
    options?: MachineFileReadOptions,
  ): Promise<Response>;
  readMultiple(
    paths: readonly MachineFilePath[],
    options?: MachineFileReadMultipleOptions,
  ): Promise<MachineFileReadResult[]>;
  stat(path: MachineFilePath, signal?: AbortSignal): Promise<MachineFileInfo>;
  list(
    path?: MachineFilePath,
    options?: MachineFileListOptions,
  ): Promise<MachineFileInfo[]>;
  write(
    path: MachineFilePath,
    body: MachineFileWriteBody,
    options?: MachineFileWriteOptions,
  ): Promise<MachineFileInfo>;
  delete(
    path: MachineFilePath,
    options?: MachineFileDeleteOptions,
  ): Promise<void>;
  deleteMultiple<Path extends MachineFilePath>(
    targets: readonly (Path | MachineFileDeleteTarget<Path>)[],
    options?: MachineFileDeleteMultipleOptions,
  ): Promise<MachineFileDeleteResult<Path>[]>;
  createDirectory(
    path: MachineFilePath,
    options?: MachineDirectoryCreateOptions,
  ): Promise<void>;
  move(
    source: MachineFilePath,
    destination: MachineFilePath,
    options?: MachineFileTransferOptions,
  ): Promise<MachineFileTransferResult>;
  copy(
    source: MachineFilePath,
    destination: MachineFilePath,
    options?: MachineFileCopyOptions,
  ): Promise<MachineFileTransferResult>;
}

type FileRequest = (
  path: string,
  init?: MachineFileRequestInit,
  onUploadProgress?: (progress: MachineFileUploadProgress) => void,
) => Promise<Response>;
type SyncUpdate = {
  path: MachineFilePath;
  info: MachineFileInfo | null;
};
type SyncReport =
  | { status: "ok"; token: string; updates: SyncUpdate[] }
  | { status: "invalid" };

const SYNC_WAIT_SECONDS = 30;
const SYNC_RETRY_MAX_MS = 5_000;
const DELETE_MULTIPLE_CONCURRENCY = 8;

const FILE_PROPERTIES = `
    <d:creationdate/>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getetag/>
    <d:getlastmodified/>
    <d:resourcetype/>
    <r:owner-id xmlns:r="urn:rool:dav"/>
    <r:access xmlns:r="urn:rool:dav"/>`;
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>${FILE_PROPERTIES}
  </d:prop>
</d:propfind>`;
const STORAGE_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:quota-used-bytes/>
    <d:quota-available-bytes/>
  </d:prop>
</d:propfind>`;

function readMultipleBody(hrefs: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<r:read-multiple xmlns:r="urn:rool:dav" xmlns:d="DAV:">
${hrefs.map((href) => `  <d:href>${encodeXml(href)}</d:href>`).join("\n")}
</r:read-multiple>`;
}

function syncCollectionBody(token?: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:">
  ${token ? `<d:sync-token>${encodeXml(token)}</d:sync-token>` : ""}
  <d:sync-level>infinite</d:sync-level>
  <d:prop>${FILE_PROPERTIES}
  </d:prop>
</d:sync-collection>`;
}

export class RoolFileError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(response: Response, body: string) {
    super(
      `Machine file request failed: ${response.status} ${response.statusText}`,
    );
    this.name = "RoolFileError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
  }
}

class SyncedMachineFileTree implements MachineFileTree {
  private entries = new Map<MachineFilePath, MachineFileInfo>();
  private readonly listeners = new Set<
    (change: MachineFileTreeChange) => void
  >();

  get(path: MachineFilePath): MachineFileInfo | undefined {
    const info = this.entries.get(path);
    return info ? cloneFileInfo(info) : undefined;
  }

  etag(path: MachineFilePath): string | undefined {
    return this.entries.get(path)?.etag;
  }

  list(
    path?: MachineFilePath,
    options: MachineFileTreeListOptions = {},
  ): MachineFileInfo[] {
    const entries = [...this.entries.values()].filter((entry) => {
      if (!path) {
        return options.recursive || parentPath(entry.path) === undefined;
      }
      if (entry.path === path || !entry.path.startsWith(`${path}/`)) {
        return false;
      }
      return options.recursive || parentPath(entry.path) === path;
    });
    return entries
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(cloneFileInfo);
  }

  subscribe(listener: (change: MachineFileTreeChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reconcile(nextEntries: MachineFileInfo[]): void {
    const next = new Map(
      nextEntries.map((entry) => [entry.path, cloneFileInfo(entry)]),
    );
    const changed = nextEntries
      .filter((entry) => !sameFileInfo(this.entries.get(entry.path), entry))
      .map((entry) => entry.path);
    const deleted = [...this.entries.keys()].filter((path) => !next.has(path));
    this.entries = next;
    this.emit({ reset: true, changed, deleted });
  }

  apply(updates: SyncUpdate[]): void {
    const changed = new Set<MachineFilePath>();
    const deleted = new Set<MachineFilePath>();

    for (const update of updates) {
      if (update.info) {
        if (!sameFileInfo(this.entries.get(update.path), update.info)) {
          this.entries.set(update.path, cloneFileInfo(update.info));
          changed.add(update.path);
        }
        continue;
      }

      for (const existingPath of [...this.entries.keys()]) {
        const isDeletedPath =
          existingPath === update.path ||
          existingPath.startsWith(`${update.path}/`);
        if (!isDeletedPath) continue;
        this.entries.delete(existingPath);
        changed.delete(existingPath);
        deleted.add(existingPath);
      }
    }

    if (changed.size === 0 && deleted.size === 0) return;
    this.emit({
      reset: false,
      changed: [...changed],
      deleted: [...deleted],
    });
  }

  private emit(change: MachineFileTreeChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

class SyncedMachineFiles implements MachineFiles {
  readonly tree: MachineFileTree;

  private readonly syncedTree = new SyncedMachineFileTree();
  private watchController: AbortController | null = null;
  private startingWatch: Promise<void> | null = null;
  private syncToken: string | null = null;
  private currentSyncError: unknown = null;

  constructor(
    private readonly machineId: string,
    private readonly request: FileRequest,
  ) {
    if (!machineId) throw new Error("machineId is required");
    this.tree = this.syncedTree;
  }

  get isWatching(): boolean {
    return this.watchController !== null;
  }

  get watchError(): unknown {
    return this.currentSyncError;
  }

  async watch(): Promise<void> {
    if (this.startingWatch) return this.startingWatch;
    if (this.watchController) return;

    const controller = new AbortController();
    this.watchController = controller;
    const startingWatch = this.initializeSync(controller);
    this.startingWatch = startingWatch;
    try {
      await startingWatch;
    } catch (error) {
      if (this.watchController === controller) this.watchController = null;
      controller.abort();
      throw error;
    } finally {
      if (this.startingWatch === startingWatch) this.startingWatch = null;
    }
  }

  unwatch(): void {
    this.watchController?.abort();
    this.watchController = null;
    this.syncToken = null;
  }

  href(path?: MachineFilePath): string {
    const prefix = `/v2/machines/${encodeURIComponent(this.machineId)}/dav`;
    if (!path) return prefix;
    return `${prefix}/${encodeFilePath(path)}`;
  }

  async options(path?: MachineFilePath): Promise<MachineFileCapabilities> {
    const response = await this.request(this.href(path), { method: "OPTIONS" });
    await assertStatus(response, 204);
    return {
      methods: (response.headers.get("Allow") ?? "")
        .split(",")
        .map((method) => method.trim())
        .filter(Boolean),
      acceptsRanges: response.headers.get("Accept-Ranges") === "bytes",
      createsParents: (response.headers.get("DAV") ?? "")
        .split(",")
        .map((token) => token.trim())
        .includes("rool-create-parents"),
      readsMultiple: (response.headers.get("DAV") ?? "")
        .split(",")
        .map((token) => token.trim())
        .includes("rool-read-multiple"),
      synchronizes: (response.headers.get("DAV") ?? "")
        .split(",")
        .map((token) => token.trim())
        .includes("sync-collection"),
      maxUploadBytes: nonnegativeHeaderInteger(
        response,
        "Rool-Max-Upload-Bytes",
      ),
    };
  }

  async getStorageUsage(signal?: AbortSignal): Promise<MachineStorageUsage> {
    const response = await this.request(this.href(), {
      method: "PROPFIND",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "0",
      },
      body: STORAGE_PROPFIND_BODY,
      signal,
    });
    await assertStatus(response, 207);
    return parseStorageUsage(await response.text());
  }

  async read(
    path: MachineFilePath,
    options: MachineFileReadOptions = {},
  ): Promise<Response> {
    const headers = conditionHeaders(options);
    if (options.range) headers.set("Range", rangeHeader(options.range));
    if (options.ifRange) headers.set("If-Range", options.ifRange);
    const response = await this.request(this.href(path), {
      method: "GET",
      headers,
      signal: options.signal,
    });
    if ([200, 206, 304].includes(response.status)) return response;
    throw await fileError(response);
  }

  async readMultiple(
    paths: readonly MachineFilePath[],
    options: MachineFileReadMultipleOptions = {},
  ): Promise<MachineFileReadResult[]> {
    if (paths.length === 0) return [];
    const response = await this.request(this.href(), {
      method: "REPORT",
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: readMultipleBody(paths.map((path) => this.href(path))),
      signal: options.signal,
    });
    await assertStatus(response, 200);
    return parseReadMultiple(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("Content-Type"),
      this.machineId,
      paths,
    );
  }

  async stat(
    path: MachineFilePath,
    signal?: AbortSignal,
  ): Promise<MachineFileInfo> {
    const entries = await this.propfind(path, "0", signal);
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry) throw new Error(`PROPFIND did not return ${path}`);
    return entry;
  }

  async list(
    path?: MachineFilePath,
    options: MachineFileListOptions = {},
  ): Promise<MachineFileInfo[]> {
    const depth = options.recursive ? "infinity" : "1";
    const entries = await this.propfind(path, depth, options.signal);
    return path
      ? entries.filter((candidate) => candidate.path !== path)
      : entries;
  }

  async write(
    path: MachineFilePath,
    body: MachineFileWriteBody,
    options: MachineFileWriteOptions = {},
  ): Promise<MachineFileInfo> {
    const headers = conditionHeaders(options);
    headers.set("Prefer", "return=representation");
    if (options.contentType) headers.set("Content-Type", options.contentType);
    if (options.createParents) {
      headers.set(
        "Rool-Create-Parents",
        options.createParents === "private" ? "private" : "1",
      );
    }
    const response = await this.request(
      this.href(path),
      {
        method: "PUT",
        headers,
        body,
        signal: options.signal,
      },
      options.onUploadProgress,
    );
    await assertStatus(response, 200, 201);
    const written = parsePropfind(await response.text(), this.machineId).find(
      (candidate) => candidate.path === path,
    );
    if (!written) throw new Error(`PUT did not return metadata for ${path}`);
    return written;
  }

  async delete(
    path: MachineFilePath,
    options: MachineFileDeleteOptions = {},
  ): Promise<void> {
    const response = await this.request(this.href(path), {
      method: "DELETE",
      headers: conditionHeaders(options),
      signal: options.signal,
    });
    await assertStatus(response, 204);
  }

  async deleteMultiple<Path extends MachineFilePath>(
    targets: readonly (Path | MachineFileDeleteTarget<Path>)[],
    options: MachineFileDeleteMultipleOptions = {},
  ): Promise<MachineFileDeleteResult<Path>[]> {
    options.signal?.throwIfAborted();
    const results = new Array<MachineFileDeleteResult<Path>>(targets.length);
    let nextIndex = 0;

    const deleteNext = async (): Promise<void> => {
      while (nextIndex < targets.length) {
        const index = nextIndex++;
        const target = targets[index];
        const request = typeof target === "string" ? { path: target } : target;
        const { path, ...preconditions } = request;
        try {
          await this.delete(path, { ...preconditions, signal: options.signal });
          results[index] = { ok: true, path };
        } catch (error) {
          if (options.signal?.aborted) throw options.signal.reason;
          results[index] = { ok: false, path, error };
        }
      }
    };

    const concurrency = Math.min(DELETE_MULTIPLE_CONCURRENCY, targets.length);
    await Promise.all(Array.from({ length: concurrency }, deleteNext));
    return results;
  }

  async createDirectory(
    path: MachineFilePath,
    options: MachineDirectoryCreateOptions = {},
  ): Promise<void> {
    const response = await this.request(this.href(path), {
      method: "MKCOL",
      signal: options.signal,
    });
    await assertStatus(response, 201);
  }

  async move(
    source: MachineFilePath,
    destination: MachineFilePath,
    options: MachineFileTransferOptions = {},
  ): Promise<MachineFileTransferResult> {
    return this.transfer("MOVE", source, destination, options, "infinity");
  }

  async copy(
    source: MachineFilePath,
    destination: MachineFilePath,
    options: MachineFileCopyOptions = {},
  ): Promise<MachineFileTransferResult> {
    const depth = options.recursive === false ? "0" : "infinity";
    return this.transfer("COPY", source, destination, options, depth);
  }

  private async initializeSync(controller: AbortController): Promise<void> {
    const report = await this.syncCollection(undefined, controller.signal);
    if (report.status === "invalid") {
      throw new Error("Initial sync-collection returned an invalid token");
    }
    if (controller.signal.aborted) return;

    this.syncedTree.reconcile(
      report.updates.flatMap((update) => (update.info ? [update.info] : [])),
    );
    this.syncToken = report.token;
    this.currentSyncError = null;
    void this.runSyncLoop(controller);
  }

  private async runSyncLoop(controller: AbortController): Promise<void> {
    let retryMs = 250;

    while (this.watchController === controller && !controller.signal.aborted) {
      try {
        const token = this.syncToken;
        if (!token) throw new Error("Machine file sync token is missing");
        let report = await this.syncCollection(
          token,
          controller.signal,
          SYNC_WAIT_SECONDS,
        );
        if (report.status === "invalid") {
          report = await this.syncCollection(undefined, controller.signal);
          if (report.status === "invalid") {
            throw new Error(
              "Initial sync-collection returned an invalid token",
            );
          }
          if (controller.signal.aborted) return;
          this.syncedTree.reconcile(
            report.updates.flatMap((update) =>
              update.info ? [update.info] : [],
            ),
          );
        } else {
          if (controller.signal.aborted) return;
          this.syncedTree.apply(report.updates);
        }

        this.syncToken = report.token;
        this.currentSyncError = null;
        retryMs = 250;
      } catch (error) {
        if (controller.signal.aborted) return;
        this.currentSyncError = error;
        await abortableDelay(retryMs, controller.signal);
        retryMs = Math.min(retryMs * 2, SYNC_RETRY_MAX_MS);
      }
    }
  }

  private async syncCollection(
    token: string | undefined,
    signal: AbortSignal,
    waitSeconds?: number,
  ): Promise<SyncReport> {
    const headers = new Headers({
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "infinity",
    });
    if (waitSeconds !== undefined) {
      headers.set("Prefer", `wait=${waitSeconds}`);
    }

    const response = await this.request(this.href(), {
      method: "REPORT",
      headers,
      body: syncCollectionBody(token),
      signal,
    });
    const body = await response.text();
    if (response.status === 403 && hasXmlElement(body, "valid-sync-token")) {
      return { status: "invalid" };
    }
    if (response.status !== 207) throw new RoolFileError(response, body);
    return {
      status: "ok",
      ...parseSyncCollection(body, this.machineId),
    };
  }

  private async propfind(
    path: MachineFilePath | undefined,
    depth: "0" | "1" | "infinity",
    signal?: AbortSignal,
  ): Promise<MachineFileInfo[]> {
    const response = await this.request(this.href(path), {
      method: "PROPFIND",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: depth,
      },
      body: PROPFIND_BODY,
      signal,
    });
    await assertStatus(response, 207);
    return parsePropfind(await response.text(), this.machineId);
  }

  private async transfer(
    method: "MOVE" | "COPY",
    source: MachineFilePath,
    destination: MachineFilePath,
    options: MachineFileTransferOptions,
    depth: "0" | "infinity",
  ): Promise<MachineFileTransferResult> {
    const headers = conditionHeaders(options);
    headers.set("Depth", depth);
    headers.set("Destination", this.href(destination));
    headers.set("Overwrite", options.overwrite === false ? "F" : "T");
    const response = await this.request(this.href(source), {
      method,
      headers,
      signal: options.signal,
    });
    await assertStatus(response, 201, 204);
    return {
      source,
      destination,
      overwritten: response.status === 204,
    };
  }
}

export function createMachineFiles(
  machineId: string,
  request: FileRequest,
): MachineFiles {
  return new SyncedMachineFiles(machineId, request);
}

function encodeFilePath(path: MachineFilePath): string {
  const isSpacePath = path === "/space" || path.startsWith("/space/");
  const isDrivePath = path === "/rool-drive" || path.startsWith("/rool-drive/");
  if (!isSpacePath && !isDrivePath) {
    throw new Error("Machine file paths must be under /space or /rool-drive");
  }
  const segments = path.slice(1).split("/");
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\0")
    ) {
      throw new Error(`Invalid machine file path: ${path}`);
    }
  }
  return segments.map(encodeURIComponent).join("/");
}

function conditionHeaders(options: {
  ifMatch?: string;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  ifUnmodifiedSince?: string;
}): Headers {
  const headers = new Headers();
  if (options.ifMatch) headers.set("If-Match", options.ifMatch);
  if (options.ifNoneMatch) headers.set("If-None-Match", options.ifNoneMatch);
  if (options.ifModifiedSince)
    headers.set("If-Modified-Since", options.ifModifiedSince);
  if (options.ifUnmodifiedSince)
    headers.set("If-Unmodified-Since", options.ifUnmodifiedSince);
  return headers;
}

function rangeHeader(range: MachineFileRange): string {
  if ("suffixLength" in range) {
    if (!Number.isSafeInteger(range.suffixLength) || range.suffixLength <= 0) {
      throw new Error(
        "Machine file range suffixLength must be a positive integer",
      );
    }
    return `bytes=-${range.suffixLength}`;
  }
  if (!Number.isSafeInteger(range.start) || range.start < 0) {
    throw new Error("Machine file range start must be a non-negative integer");
  }
  if (range.end === undefined) return `bytes=${range.start}-`;
  if (!Number.isSafeInteger(range.end) || range.end < range.start) {
    throw new Error("Machine file range end must be at least its start");
  }
  return `bytes=${range.start}-${range.end}`;
}

function parseReadMultiple(
  data: Uint8Array,
  contentType: string | null,
  machineId: string,
  requestedPaths: readonly MachineFilePath[],
): MachineFileReadResult[] {
  const boundary = multipartBoundary(contentType);
  const marker = new TextEncoder().encode(`--${boundary}`);
  const crlf = new Uint8Array([13, 10]);
  const headerEnd = new Uint8Array([13, 10, 13, 10]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const results: MachineFileReadResult[] = [];
  let offset = 0;

  expectBytes(data, offset, marker, "multipart boundary");
  offset += marker.length;
  while (true) {
    if (data[offset] === 45 && data[offset + 1] === 45) {
      offset += 2;
      if (offset < data.length) {
        expectBytes(data, offset, crlf, "multipart closing newline");
        offset += crlf.length;
      }
      if (offset !== data.length) {
        throw new Error("read-multiple response has data after its boundary");
      }
      break;
    }

    expectBytes(data, offset, crlf, "multipart boundary newline");
    offset += crlf.length;
    const outerEnd = findBytes(data, headerEnd, offset);
    if (outerEnd < 0) {
      throw new Error("read-multiple part has incomplete headers");
    }
    const outerHeaders = parseHttpHeaders(
      decoder.decode(data.subarray(offset, outerEnd)),
    );
    if (
      outerHeaders.get("content-type")?.toLowerCase() !== "application/http"
    ) {
      throw new Error("read-multiple part is not application/http");
    }
    offset = outerEnd + headerEnd.length;

    const responseEnd = findBytes(data, headerEnd, offset);
    if (responseEnd < 0) {
      throw new Error("read-multiple HTTP response has incomplete headers");
    }
    const responseLines = decoder
      .decode(data.subarray(offset, responseEnd))
      .split("\r\n");
    const statusMatch = /^HTTP\/1\.1\s+(\d{3})(?:\s|$)/.exec(
      responseLines.shift() ?? "",
    );
    if (!statusMatch) {
      throw new Error("read-multiple part has an invalid HTTP status");
    }
    const status = Number(statusMatch[1]);
    const headers = parseHttpHeaders(responseLines.join("\r\n"));
    const rawLength = headers.get("content-length");
    const length = rawLength === undefined ? NaN : Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("read-multiple part has an invalid Content-Length");
    }
    const href = headers.get("content-location");
    if (!href) {
      throw new Error("read-multiple part is missing Content-Location");
    }
    const path = machinePathFromHref(href, machineId);
    const expectedPath = requestedPaths[results.length];
    if (!path || path !== expectedPath) {
      throw new Error(
        `read-multiple returned ${path ?? href}, expected ${expectedPath}`,
      );
    }

    offset = responseEnd + headerEnd.length;
    if (offset + length > data.length) {
      throw new Error(`read-multiple body is truncated for ${path}`);
    }
    const body = data.slice(offset, offset + length);
    offset += length;
    expectBytes(data, offset, crlf, "read-multiple body newline");
    offset += crlf.length;

    if (status === 200) {
      const etag = headers.get("etag");
      const fileContentType = headers.get("content-type");
      if (!etag || !fileContentType) {
        throw new Error(`read-multiple omitted file metadata for ${path}`);
      }
      results.push({
        ok: true,
        path,
        status: 200,
        etag,
        contentType: fileContentType,
        size: length,
        body,
      });
    } else {
      results.push({ ok: false, path, status });
    }

    expectBytes(data, offset, marker, "multipart boundary");
    offset += marker.length;
  }

  if (results.length !== requestedPaths.length) {
    throw new Error(
      `read-multiple returned ${results.length} of ${requestedPaths.length} results`,
    );
  }
  return results;
}

function multipartBoundary(contentType: string | null): string {
  if (!/^multipart\/mixed(?:\s*;|$)/i.test(contentType ?? "")) {
    throw new Error("read-multiple response is not multipart/mixed");
  }
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
    contentType ?? "",
  );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || /[\r\n]/.test(boundary)) {
    throw new Error("read-multiple response has no multipart boundary");
  }
  return boundary;
}

function parseHttpHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  if (!value) return headers;
  for (const line of value.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid multipart header: ${line}`);
    const name = line.slice(0, separator).trim().toLowerCase();
    const headerValue = line.slice(separator + 1).trim();
    if (headers.has(name))
      throw new Error(`Duplicate multipart header: ${name}`);
    headers.set(name, headerValue);
  }
  return headers;
}

function findBytes(
  data: Uint8Array,
  needle: Uint8Array,
  offset: number,
): number {
  for (let index = offset; index <= data.length - needle.length; index++) {
    let matches = true;
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex++) {
      if (data[index + needleIndex] !== needle[needleIndex]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function expectBytes(
  data: Uint8Array,
  offset: number,
  expected: Uint8Array,
  description: string,
): void {
  for (let index = 0; index < expected.length; index++) {
    if (data[offset + index] !== expected[index]) {
      throw new Error(`Invalid ${description}`);
    }
  }
}

function parsePropfind(xml: string, machineId: string): MachineFileInfo[] {
  return xmlElements(xml, "response").flatMap((responseXml) => {
    const info = fileInfoFromResponse(responseXml, machineId);
    return info ? [info] : [];
  });
}

function nonnegativeHeaderInteger(
  response: Response,
  name: string,
): number | null {
  const raw = response.headers.get(name);
  if (raw === null) return null;

  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`OPTIONS returned invalid ${name}: ${raw}`);
  }
  return value;
}

function parseStorageUsage(xml: string): MachineStorageUsage {
  const response = xmlElements(xml, "response")[0];
  if (response === undefined) {
    throw new Error("Storage PROPFIND returned no DAV:response");
  }
  return {
    usedBytes: nonnegativeXmlInteger(response, "quota-used-bytes"),
    availableBytes: nonnegativeXmlInteger(response, "quota-available-bytes"),
  };
}

function nonnegativeXmlInteger(xml: string, name: string): number {
  const raw = requiredXmlText(xml, name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`PROPFIND returned invalid DAV:${name}: ${raw}`);
  }
  return value;
}

function parseSyncCollection(
  xml: string,
  machineId: string,
): { token: string; updates: SyncUpdate[] } {
  const token = requiredXmlText(xml, "sync-token");
  const updates: SyncUpdate[] = [];
  for (const responseXml of xmlElements(xml, "response")) {
    const href = requiredXmlText(responseXml, "href");
    const path = machinePathFromHref(href, machineId);
    if (!path) continue;

    const hasProperties = hasXmlElement(responseXml, "propstat");
    const deleted =
      !hasProperties && /HTTP\/1\.1\s+404\s+Not Found/i.test(responseXml);
    if (deleted) {
      updates.push({ path, info: null });
      continue;
    }

    const info = fileInfoFromResponse(responseXml, machineId);
    if (!info) throw new Error(`sync-collection omitted metadata for ${path}`);
    updates.push({ path, info });
  }
  return { token, updates };
}

function fileInfoFromResponse(
  responseXml: string,
  machineId: string,
): MachineFileInfo | null {
  const href = requiredXmlText(responseXml, "href");
  const path = machinePathFromHref(href, machineId);
  if (!path) return null;

  const base = {
    path,
    name: requiredXmlText(responseXml, "displayname"),
    etag: requiredXmlText(responseXml, "getetag"),
    createdAt: requiredXmlText(responseXml, "creationdate"),
    lastModified: requiredXmlText(responseXml, "getlastmodified"),
    ownerId: optionalXmlText(responseXml, "owner-id"),
    access: fileAccessFromResponse(responseXml),
  };
  const resourceType = requiredXmlElement(responseXml, "resourcetype");
  if (hasXmlElement(resourceType, "collection")) {
    return { ...base, kind: "directory" };
  }

  const rawSize = requiredXmlText(responseXml, "getcontentlength");
  const size = Number(rawSize);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`PROPFIND returned invalid size ${rawSize} for ${path}`);
  }
  return {
    ...base,
    kind: "file",
    size,
    contentType: requiredXmlText(responseXml, "getcontenttype"),
  };
}

const ACCESS_AUDIENCES: readonly MachineFileAccessAudience[] = [
  "resource-owner",
  "machine-admins",
  "machine-editors",
  "machine-members",
];

function fileAccessFromResponse(responseXml: string): MachineFileAccess {
  const accessXml = requiredXmlElement(responseXml, "access");
  const currentUserXml = requiredXmlElement(accessXml, "current-user");
  const readableByXml = requiredXmlElement(accessXml, "readable-by");
  const writableByXml = requiredXmlElement(accessXml, "writable-by");
  return {
    currentUser: {
      read: hasXmlElement(currentUserXml, "read"),
      write: hasXmlElement(currentUserXml, "write"),
    },
    readableBy: ACCESS_AUDIENCES.filter((audience) =>
      hasXmlElement(readableByXml, audience),
    ),
    writableBy: ACCESS_AUDIENCES.filter((audience) =>
      hasXmlElement(writableByXml, audience),
    ),
  };
}

function machinePathFromHref(
  href: string,
  machineId: string,
): MachineFilePath | null {
  const url = new URL(href, "http://rool.local");
  const encodedParts = url.pathname.split("/");
  if (encodedParts.shift() !== "") {
    throw new Error(`PROPFIND returned invalid href: ${href}`);
  }
  if (encodedParts.at(-1) === "") encodedParts.pop();
  const parts = encodedParts.map(decodeURIComponent);
  const isMachineHref =
    parts[0] === "v2" &&
    parts[1] === "machines" &&
    parts[2] === machineId &&
    parts[3] === "dav";
  if (!isMachineHref) {
    throw new Error(`PROPFIND returned an href outside the machine: ${href}`);
  }

  const pathParts = parts.slice(4);
  if (pathParts.length === 0) return null;
  if (pathParts[0] !== "space" && pathParts[0] !== "rool-drive") {
    throw new Error(`PROPFIND returned an unsupported machine path: ${href}`);
  }
  for (const part of pathParts) {
    if (!part || part === "." || part === ".." || part.includes("/")) {
      throw new Error(`PROPFIND returned an invalid machine path: ${href}`);
    }
  }
  return `/${pathParts.join("/")}` as MachineFilePath;
}

function xmlElements(xml: string, name: string): string[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}>`,
    "gi",
  );
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function requiredXmlElement(xml: string, name: string): string {
  const value = xmlElements(xml, name)[0];
  if (value !== undefined) return value;

  const selfClosing = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*/\\s*>`,
    "i",
  ).test(xml);
  if (selfClosing) return "";
  throw new Error(`PROPFIND response is missing DAV:${name}`);
}

function requiredXmlText(xml: string, name: string): string {
  const value = decodeXml(
    requiredXmlElement(xml, name).replace(/<[^>]*>/g, ""),
  );
  if (!value) throw new Error(`PROPFIND response has empty DAV:${name}`);
  return value;
}

function optionalXmlText(xml: string, name: string): string | undefined {
  const element = xmlElements(xml, name)[0];
  if (element === undefined) return undefined;
  return decodeXml(element.replace(/<[^>]*>/g, "")) || undefined;
}

function hasXmlElement(xml: string, name: string): boolean {
  return new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?\\s*\\/?\\s*>`,
    "i",
  ).test(xml);
}

function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string): string {
  return value
    .trim()
    .replace(/&#x([0-9a-f]+);/gi, (_entity, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&#([0-9]+);/g, (_entity, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function cloneFileInfo(info: MachineFileInfo): MachineFileInfo {
  return {
    ...info,
    access: {
      currentUser: { ...info.access.currentUser },
      readableBy: [...info.access.readableBy],
      writableBy: [...info.access.writableBy],
    },
  };
}

function sameFileInfo(
  current: MachineFileInfo | undefined,
  next: MachineFileInfo,
): boolean {
  if (!current || current.kind !== next.kind) return false;
  if (
    current.etag !== next.etag ||
    current.name !== next.name ||
    current.createdAt !== next.createdAt ||
    current.lastModified !== next.lastModified ||
    current.ownerId !== next.ownerId ||
    current.access.currentUser.read !== next.access.currentUser.read ||
    current.access.currentUser.write !== next.access.currentUser.write ||
    current.access.readableBy.join("\0") !==
      next.access.readableBy.join("\0") ||
    current.access.writableBy.join("\0") !== next.access.writableBy.join("\0")
  ) {
    return false;
  }
  if (current.kind === "directory" || next.kind === "directory") return true;
  return current.size === next.size && current.contentType === next.contentType;
}

function parentPath(path: MachineFilePath): MachineFilePath | undefined {
  const separator = path.lastIndexOf("/");
  if (separator === 0) return undefined;
  return path.slice(0, separator) as MachineFilePath;
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function assertStatus(
  response: Response,
  ...statuses: number[]
): Promise<void> {
  if (statuses.includes(response.status)) return;
  throw await fileError(response);
}

async function fileError(response: Response): Promise<RoolFileError> {
  return new RoolFileError(response, await response.text());
}
