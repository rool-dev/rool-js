import {
  RoolFileError,
  type MachineFileDeleteResult,
  type MachineFileDeleteTarget,
  type MachineFileInfo,
  type MachineFilePath,
  type MachineFiles,
} from "./files.js";

export type MachineMetadata = Record<string, unknown>;

export type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "array"; inner?: FieldType }
  | { kind: "maybe"; inner: FieldType }
  | { kind: "enum"; values: string[] }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "ref" };

export interface FieldDef {
  name: string;
  type: FieldType;
}

export interface CollectionDef {
  fields: FieldDef[];
  schemaOrgType?: string;
}

export type SpaceSchema = Record<string, CollectionDef>;
export type MachineCollectionPath = `/space/${string}`;
export type RoolObjectPath = `/space/${string}/${string}.json`;

export interface MachineCollection {
  name: string;
  path: MachineCollectionPath;
  definition: CollectionDef;
  etag: string;
}

export interface RoolObject {
  path: RoolObjectPath;
  body: Record<string, unknown>;
}

export type RoolObjectRemoveResult = MachineFileDeleteResult<RoolObjectPath>;

export interface MachineStructuredRequestOptions {
  signal?: AbortSignal;
}

export interface RoolObjectMoveOptions extends MachineStructuredRequestOptions {
  overwrite?: boolean;
}

export interface MachineMetadataApi {
  get(options?: MachineStructuredRequestOptions): Promise<MachineMetadata>;
  set(
    key: string,
    value: unknown,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineMetadata>;
  delete(
    key: string,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineMetadata>;
}

export interface MachineCollectionsApi {
  list(options?: MachineStructuredRequestOptions): Promise<MachineCollection[]>;
  get(
    name: string,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineCollection | undefined>;
  create(
    name: string,
    definition: CollectionDef,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineCollection>;
  replace(
    name: string,
    definition: CollectionDef,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineCollection>;
  remove(
    name: string,
    options?: MachineStructuredRequestOptions,
  ): Promise<void>;
}

export interface MachineObjectsApi {
  list(options?: { collection?: string }): RoolObjectPath[];
  get(
    path: RoolObjectPath,
    options?: MachineStructuredRequestOptions,
  ): Promise<RoolObject | undefined>;
  getMultiple(
    paths: readonly RoolObjectPath[],
    options?: MachineStructuredRequestOptions,
  ): Promise<(RoolObject | undefined)[]>;
  create(
    path: RoolObjectPath,
    body: Record<string, unknown>,
    options?: MachineStructuredRequestOptions,
  ): Promise<RoolObject>;
  replace(
    path: RoolObjectPath,
    body: Record<string, unknown>,
    options?: MachineStructuredRequestOptions,
  ): Promise<RoolObject>;
  patch(
    path: RoolObjectPath,
    patch: Record<string, unknown>,
    options?: MachineStructuredRequestOptions,
  ): Promise<RoolObject>;
  move(
    source: RoolObjectPath,
    destination: RoolObjectPath,
    options?: RoolObjectMoveOptions,
  ): Promise<RoolObject>;
  remove(
    path: RoolObjectPath,
    options?: MachineStructuredRequestOptions,
  ): Promise<void>;
  removeMultiple(
    paths: readonly RoolObjectPath[],
    options?: MachineStructuredRequestOptions,
  ): Promise<RoolObjectRemoveResult[]>;
}

export interface MachineStructuredApis {
  readonly metadata: MachineMetadataApi;
  readonly collections: MachineCollectionsApi;
  readonly objects: MachineObjectsApi;
}

type ReadFile = {
  path: MachineFilePath;
  etag: string;
  body: Uint8Array;
};

const META_PATH = "/space/.meta.json";
const METADATA_WRITE_ATTEMPTS = 5;
const COLLECTION_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const OBJECT_RE =
  /^\/space\/([a-zA-Z][a-zA-Z0-9_-]*)\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\.json$/;
const READ_MULTIPLE_FILE_LIMIT = 128;
const READ_MULTIPLE_BYTE_LIMIT = 16 * 1024 * 1024;
const UNKNOWN_FILE_BYTES = 2 * 1024 * 1024;
const MULTIPLE_REMOVE_CONCURRENCY = 8;

class StructuredMachineState implements MachineStructuredApis {
  readonly metadata: MachineMetadataApi;
  readonly collections: MachineCollectionsApi;
  readonly objects: MachineObjectsApi;

  constructor(
    private readonly files: MachineFiles,
    private readonly isWatching: () => boolean,
  ) {
    this.metadata = {
      get: (options) => this.getMetadata(options),
      set: (key, value, options) => this.setMetadata(key, value, options),
      delete: (key, options) => this.deleteMetadata(key, options),
    };
    this.collections = {
      list: (options) => this.listCollections(options),
      get: (name, options) => this.getCollection(name, options),
      create: (name, definition, options) =>
        this.createCollection(name, definition, options),
      replace: (name, definition, options) =>
        this.replaceCollection(name, definition, options),
      remove: (name, options) => this.removeCollection(name, options),
    };
    this.objects = {
      list: (options) => this.listObjects(options),
      get: (path, options) => this.getObject(path, options),
      getMultiple: (paths, options) => this.getMultipleObjects(paths, options),
      create: (path, body, options) => this.createObject(path, body, options),
      replace: (path, body, options) => this.replaceObject(path, body, options),
      patch: (path, patch, options) => this.patchObject(path, patch, options),
      move: (source, destination, options) =>
        this.moveObject(source, destination, options),
      remove: (path, options) => this.removeObject(path, options),
      removeMultiple: (paths, options) =>
        this.removeMultipleObjects(paths, options),
    };
  }

  private async getMetadata(
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineMetadata> {
    const file = await this.readOptionalFile(META_PATH, options.signal);
    if (!file) return {};
    return parseJsonObject(file, "Machine metadata");
  }

  private setMetadata(
    key: string,
    value: unknown,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineMetadata> {
    return this.writeMetadata(key, value, false, options.signal);
  }

  private deleteMetadata(
    key: string,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineMetadata> {
    return this.writeMetadata(key, null, true, options.signal);
  }

  private async writeMetadata(
    key: string,
    value: unknown,
    remove: boolean,
    signal?: AbortSignal,
  ): Promise<MachineMetadata> {
    if (!key) throw new Error("Machine metadata key is required");

    for (let attempt = 1; attempt <= METADATA_WRITE_ATTEMPTS; attempt += 1) {
      const file = await this.readOptionalFile(META_PATH, signal);
      const current = file ? parseJsonObject(file, "Machine metadata") : {};
      const hasKey = Object.hasOwn(current, key);
      if (remove && !hasKey) return current;
      if (
        !remove &&
        hasKey &&
        JSON.stringify(current[key]) === JSON.stringify(value)
      ) {
        return current;
      }

      const next = remove ? { ...current } : { ...current, [key]: value };
      if (remove) delete next[key];

      try {
        await this.files.write(
          META_PATH,
          serializeJsonObject(next, "Machine metadata"),
          {
            contentType: "application/json",
            ...(file ? { ifMatch: file.etag } : { ifNoneMatch: "*" }),
            signal,
          },
        );
        return next;
      } catch (error) {
        const conflict = error instanceof RoolFileError && error.status === 412;
        if (!conflict || attempt === METADATA_WRITE_ATTEMPTS) throw error;
      }
    }

    throw new Error("Machine metadata update exhausted its attempts");
  }

  private async listCollections(
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineCollection[]> {
    const entries = await this.spaceEntries(options.signal);
    const schemaPaths = entries.flatMap((entry) => {
      const name = collectionNameFromSchemaPath(entry.path);
      return name && entry.kind === "file" ? [entry.path] : [];
    });
    const filesByPath = await this.readFiles(schemaPaths, options.signal);

    return schemaPaths.flatMap((path) => {
      const file = filesByPath.get(path);
      return file ? [collectionFromFile(file)] : [];
    });
  }

  private async getCollection(
    name: string,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineCollection | undefined> {
    const path = schemaPath(name);
    const file = await this.readOptionalFile(path, options.signal);
    return file ? collectionFromFile(file) : undefined;
  }

  private async createCollection(
    name: string,
    definition: CollectionDef,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineCollection> {
    const path = schemaPath(name);
    await this.files.write(
      path,
      serializeJsonObject(definition, `Collection ${name}`),
      {
        contentType: "application/json",
        createParents: true,
        ifNoneMatch: "*",
        signal: options.signal,
      },
    );
    return collectionFromFile(await this.readFile(path, options.signal));
  }

  private async replaceCollection(
    name: string,
    definition: CollectionDef,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineCollection> {
    const path = schemaPath(name);
    const etag = await this.etag(path, options.signal);
    await this.files.write(
      path,
      serializeJsonObject(definition, `Collection ${name}`),
      {
        contentType: "application/json",
        ifMatch: etag,
        signal: options.signal,
      },
    );
    return collectionFromFile(await this.readFile(path, options.signal));
  }

  private async removeCollection(
    name: string,
    options: MachineStructuredRequestOptions = {},
  ): Promise<void> {
    const path = collectionPath(name);
    await this.files.delete(path, { signal: options.signal });
  }

  private listObjects(options: { collection?: string } = {}): RoolObjectPath[] {
    if (options.collection) validateCollectionName(options.collection);
    return this.files.tree
      .list("/space", { recursive: true })
      .flatMap((entry) => {
        const parsed = parseObjectPath(entry.path);
        if (!parsed || entry.kind !== "file") return [];
        if (options.collection && parsed.collection !== options.collection) {
          return [];
        }
        return [entry.path as RoolObjectPath];
      });
  }

  private async getObject(
    path: RoolObjectPath,
    options: MachineStructuredRequestOptions = {},
  ): Promise<RoolObject | undefined> {
    requireObjectPath(path);
    const file = await this.readOptionalFile(path, options.signal);
    return file ? objectFromFile(file) : undefined;
  }

  private async getMultipleObjects(
    paths: readonly RoolObjectPath[],
    options: MachineStructuredRequestOptions = {},
  ): Promise<(RoolObject | undefined)[]> {
    const uniquePaths: RoolObjectPath[] = [];
    const seen = new Set<RoolObjectPath>();
    for (const path of paths) {
      requireObjectPath(path);
      if (seen.has(path)) continue;
      seen.add(path);
      uniquePaths.push(path);
    }

    const filesByPath = await this.readFiles(uniquePaths, options.signal);
    return paths.map((path) => {
      const file = filesByPath.get(path);
      return file ? objectFromFile(file) : undefined;
    });
  }

  private async createObject(
    path: RoolObjectPath,
    objectBody: Record<string, unknown>,
    options: MachineStructuredRequestOptions = {},
  ): Promise<RoolObject> {
    requireObjectPath(path);
    await this.files.write(
      path,
      serializeJsonObject(objectBody, `Object ${path}`),
      {
        contentType: "application/json",
        ifNoneMatch: "*",
        signal: options.signal,
      },
    );
    return objectFromFile(await this.readFile(path, options.signal));
  }

  private async replaceObject(
    path: RoolObjectPath,
    objectBody: Record<string, unknown>,
    options: MachineStructuredRequestOptions = {},
  ): Promise<RoolObject> {
    requireObjectPath(path);
    const etag = await this.etag(path, options.signal);
    await this.files.write(
      path,
      serializeJsonObject(objectBody, `Object ${path}`),
      {
        contentType: "application/json",
        ifMatch: etag,
        signal: options.signal,
      },
    );
    return objectFromFile(await this.readFile(path, options.signal));
  }

  private async patchObject(
    path: RoolObjectPath,
    patch: Record<string, unknown>,
    options: MachineStructuredRequestOptions = {},
  ): Promise<RoolObject> {
    requireObjectPath(path);
    const current = await this.readFile(path, options.signal);
    const body = parseJsonObject(current, `Object ${path}`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) delete body[key];
      else body[key] = value;
    }

    await this.files.write(path, serializeJsonObject(body, `Object ${path}`), {
      contentType: "application/json",
      ifMatch: current.etag,
      signal: options.signal,
    });
    return objectFromFile(await this.readFile(path, options.signal));
  }

  private async moveObject(
    source: RoolObjectPath,
    destination: RoolObjectPath,
    options: RoolObjectMoveOptions = {},
  ): Promise<RoolObject> {
    requireObjectPath(source);
    requireObjectPath(destination);
    const sourceEtag = await this.etag(source, options.signal);
    await this.files.move(source, destination, {
      ifMatch: sourceEtag,
      overwrite: options.overwrite ?? false,
      signal: options.signal,
    });
    return objectFromFile(await this.readFile(destination, options.signal));
  }

  private async removeObject(
    path: RoolObjectPath,
    options: MachineStructuredRequestOptions = {},
  ): Promise<void> {
    requireObjectPath(path);
    const etag = await this.etag(path, options.signal);
    await this.files.delete(path, {
      ifMatch: etag,
      signal: options.signal,
    });
  }

  private async removeMultipleObjects(
    paths: readonly RoolObjectPath[],
    options: MachineStructuredRequestOptions = {},
  ): Promise<RoolObjectRemoveResult[]> {
    for (const path of paths) requireObjectPath(path);

    const results = new Array<RoolObjectRemoveResult | undefined>(paths.length);
    const targets: {
      index: number;
      target: MachineFileDeleteTarget<RoolObjectPath>;
    }[] = [];
    for (
      let start = 0;
      start < paths.length;
      start += MULTIPLE_REMOVE_CONCURRENCY
    ) {
      const batch = paths.slice(start, start + MULTIPLE_REMOVE_CONCURRENCY);
      const etags = await Promise.all(
        batch.map(async (path, offset) => {
          try {
            return {
              index: start + offset,
              target: { path, ifMatch: await this.etag(path, options.signal) },
            };
          } catch (error) {
            if (options.signal?.aborted) throw options.signal.reason;
            results[start + offset] = { ok: false, path, error };
            return undefined;
          }
        }),
      );
      targets.push(...etags.filter((target) => target !== undefined));
    }

    const deleted = await this.files.deleteMultiple(
      targets.map(({ target }) => target),
      options,
    );
    for (const [deletedIndex, result] of deleted.entries()) {
      results[targets[deletedIndex]!.index] = result;
    }
    return results.map((result) => {
      if (!result) throw new Error("BUG: object removal omitted a result");
      return result;
    });
  }

  private async spaceEntries(signal?: AbortSignal): Promise<MachineFileInfo[]> {
    if (this.isWatching()) {
      return this.files.tree.list("/space", { recursive: true });
    }
    return this.files.list("/space", { recursive: true, signal });
  }

  private async readOptionalFile(
    path: MachineFilePath,
    signal?: AbortSignal,
  ): Promise<ReadFile | undefined> {
    try {
      return await this.readFile(path, signal);
    } catch (error) {
      if (error instanceof RoolFileError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private async readFile(
    path: MachineFilePath,
    signal?: AbortSignal,
  ): Promise<ReadFile> {
    const response = await this.files.read(path, { signal });
    const etag = response.headers.get("ETag");
    if (!etag)
      throw new Error(`Machine file response omitted ETag for ${path}`);
    return {
      path,
      etag,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }

  private async readFiles(
    paths: readonly MachineFilePath[],
    signal?: AbortSignal,
  ): Promise<Map<MachineFilePath, ReadFile>> {
    const filesByPath = new Map<MachineFilePath, ReadFile>();
    for (const batch of this.readMultipleBatches(paths)) {
      await this.readFileBatch(batch, filesByPath, signal);
    }
    return filesByPath;
  }

  private *readMultipleBatches(
    paths: readonly MachineFilePath[],
  ): Generator<MachineFilePath[]> {
    let batch: MachineFilePath[] = [];
    let bytes = 0;
    for (const path of paths) {
      const info = this.files.tree.get(path);
      const fileBytes = info?.kind === "file" ? info.size : UNKNOWN_FILE_BYTES;
      const exceedsCount = batch.length === READ_MULTIPLE_FILE_LIMIT;
      const exceedsBytes =
        batch.length > 0 && bytes + fileBytes > READ_MULTIPLE_BYTE_LIMIT;
      if (exceedsCount || exceedsBytes) {
        yield batch;
        batch = [];
        bytes = 0;
      }
      batch.push(path);
      bytes += fileBytes;
    }
    if (batch.length > 0) yield batch;
  }

  private async readFileBatch(
    paths: MachineFilePath[],
    filesByPath: Map<MachineFilePath, ReadFile>,
    signal?: AbortSignal,
  ): Promise<void> {
    let results;
    try {
      results = await this.files.readMultiple(paths, { signal });
    } catch (error) {
      const canSplit =
        error instanceof RoolFileError &&
        error.status === 413 &&
        paths.length > 1;
      if (!canSplit) throw error;
      const middle = Math.ceil(paths.length / 2);
      await this.readFileBatch(paths.slice(0, middle), filesByPath, signal);
      await this.readFileBatch(paths.slice(middle), filesByPath, signal);
      return;
    }

    for (const result of results) {
      if (result.ok) {
        filesByPath.set(result.path, {
          path: result.path,
          etag: result.etag,
          body: result.body,
        });
        continue;
      }
      if (result.status === 404) continue;
      filesByPath.set(result.path, await this.readFile(result.path, signal));
    }
  }

  private async etag(
    path: MachineFilePath,
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.files.stat(path, signal)).etag;
  }
}

export function createMachineStructuredApis(
  files: MachineFiles,
  isWatching: () => boolean,
): MachineStructuredApis {
  return new StructuredMachineState(files, isWatching);
}

function collectionPath(name: string): MachineCollectionPath {
  validateCollectionName(name);
  return `/space/${name}`;
}

function schemaPath(name: string): MachineFilePath {
  return `${collectionPath(name)}/.schema.json`;
}

function validateCollectionName(name: string): void {
  if (!COLLECTION_RE.test(name)) {
    throw new Error(
      `Collection name must start with a letter and contain only letters, digits, hyphens, and underscores: ${name}`,
    );
  }
}

function collectionNameFromSchemaPath(path: MachineFilePath): string | null {
  const match = /^\/space\/([^/]+)\/\.schema\.json$/.exec(path);
  if (!match || !COLLECTION_RE.test(match[1])) return null;
  return match[1];
}

export function isRoolObjectPath(path: string): path is RoolObjectPath {
  return OBJECT_RE.test(path);
}

function parseObjectPath(
  path: string,
): { collection: string; basename: string } | null {
  const match = OBJECT_RE.exec(path);
  return match ? { collection: match[1], basename: match[2] } : null;
}

function requireObjectPath(path: RoolObjectPath): void {
  if (isRoolObjectPath(path)) return;
  throw new Error(
    `Object path must be /space/<collection>/<basename>.json: ${path}`,
  );
}

function collectionFromFile(file: ReadFile): MachineCollection {
  const name = collectionNameFromSchemaPath(file.path);
  if (!name) {
    throw new Error(`Invalid collection schema path: ${file.path}`);
  }
  return {
    name,
    path: collectionPath(name),
    definition: parseJsonObject(
      file,
      `Collection ${name}`,
    ) as unknown as CollectionDef,
    etag: file.etag,
  };
}

function objectFromFile(file: ReadFile): RoolObject {
  return {
    path: file.path as RoolObjectPath,
    body: parseJsonObject(file, `Object ${file.path}`),
  };
}

function serializeJsonObject(value: unknown, label: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return JSON.stringify(value);
}

function parseJsonObject(
  file: ReadFile,
  label: string,
): Record<string, unknown> {
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(file.body),
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}
