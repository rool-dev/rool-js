import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient } from './graphql.js';
import type { RestClient } from './rest.js';
import { WebDAVError, type RoolWebDAV } from './webdav.js';
import type { Logger } from './logger.js';
import type {
  RoolObject,
  GetObjectsResult,
  RoolSpaceEvents,
  RoolUserRole,
  PromptOptions,
  UpdateObjectOptions,
  MoveObjectOptions,
  SpaceEvent,
  Interaction,
  Conversation,
  ConversationMeta,
  ConversationVisibility,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  CollectionOptions,
} from './types.js';
import { isObjectPath, machinePath, machineUri } from './path.js';

// 6-character alphanumeric ID — used for object names, interactionIds, conversationIds, etc.
const ENTITY_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const GET_OBJECTS_CHUNK_SIZE = 500;

export function generateEntityId(): string {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += ENTITY_CHARS[Math.floor(Math.random() * ENTITY_CHARS.length)];
  }
  return result;
}

/** Walk from a leaf interaction up through parentId to root, return in root→leaf order. */
function walkBranch(interactions: Record<string, Interaction>, leafId: string): Interaction[] {
  const path: Interaction[] = [];
  let currentId: string | null = leafId;
  while (currentId) {
    const ix: Interaction | undefined = interactions[currentId];
    if (!ix) break;
    path.push(ix);
    currentId = ix.parentId;
  }
  return path.reverse();
}

/** Find the default leaf: the most recent interaction by timestamp that has no children. */
function findDefaultLeaf(interactions: Record<string, Interaction> | undefined): string | undefined {
  if (!interactions) return undefined;
  const childSet = new Set<string>();
  for (const ix of Object.values(interactions)) {
    if (ix.parentId) childSet.add(ix.parentId);
  }
  // Leaves = interactions with no children, pick most recent
  let best: Interaction | undefined;
  for (const ix of Object.values(interactions)) {
    if (!childSet.has(ix.id)) {
      if (!best || ix.timestamp > best.timestamp) best = ix;
    }
  }
  return best?.id;
}

function objectPath(input: string): string {
  const path = machinePath(input);
  if (!isObjectPath(path)) {
    throw new Error(`Object path must be /space/<collection>/<name>.json without dotfiles: ${input}`);
  }
  return path;
}

function collectionPath(name: string): string {
  return machinePath(`/space/${name}`);
}

function schemaPath(name: string): string {
  return `${collectionPath(name)}/.schema.json`;
}

function objectFromBody(path: string, body: Record<string, unknown>): RoolObject {
  return { path, body };
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function patchBody(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

function collectionDef(input: FieldDef[] | CollectionDef, options?: CollectionOptions): CollectionDef {
  const base: CollectionDef = Array.isArray(input)
    ? { fields: input }
    : { fields: input.fields, schemaOrgType: input.schemaOrgType };
  const schemaOrgType = options?.schemaOrgType ?? base.schemaOrgType;
  return schemaOrgType ? { fields: base.fields, schemaOrgType } : { fields: base.fields };
}


interface AttachmentUpload {
  filename: string;
  contentType: string;
  body: BodyInit;
}

function attachmentBody(
  file: File | Blob | { data: string; contentType: string; filename?: string }
): AttachmentUpload {
  if (isFile(file)) {
    return {
      filename: safeAttachmentFilename(file.name, file.type),
      contentType: file.type || 'application/octet-stream',
      body: file,
    };
  }

  if (isBlob(file)) {
    const contentType = file.type || 'application/octet-stream';
    return {
      filename: safeAttachmentFilename('attachment', contentType),
      contentType,
      body: file,
    };
  }

  return {
    filename: safeAttachmentFilename(file.filename ?? 'attachment', file.contentType),
    contentType: file.contentType,
    body: base64Body(file.data),
  };
}

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function safeAttachmentFilename(name: string, contentType: string): string {
  const fallback = `attachment.${extensionForContentType(contentType)}`;
  const leaf = name.split(/[/\\]/).pop() || fallback;
  const cleaned = leaf.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, '_');
  return cleaned.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '') || fallback;
}

function extensionForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'text/markdown') return 'md';
  if (contentType === 'text/plain') return 'txt';
  if (contentType === 'text/csv') return 'csv';
  if (contentType === 'text/html') return 'html';
  if (contentType === 'application/json') return 'json';
  if (contentType === 'application/xml') return 'xml';
  return 'bin';
}

function base64Body(data: string): ArrayBuffer {
  const clean = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  if (typeof Buffer !== 'undefined') {
    const buffer = Buffer.from(clean, 'base64');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface SpaceOperationsConfig {
  id: string;
  name: string;
  role: RoolUserRole;
  /** Current user's ID (for identifying own interactions) */
  userId: string;
  /** Conversation metadata list (from openSpace). Contents are fetched on demand. */
  conversationMeta: ConversationMeta[];
  graphqlClient: GraphQLClient;
  restClient: RestClient;
  webdav: RoolWebDAV;
  logger: Logger;
  onClose: () => void;
}

/**
 * A thin handle over a space's raw APIs (GraphQL, WebDAV, REST) plus the
 * conversation roster the server pushes over SSE. It holds no schema, metadata,
 * or conversation *content* state — schema and meta live in the filesystem
 * (`/space/<collection>/.schema.json`, `/space/.meta.json`) and are read on
 * demand via {@link readSchema} / {@link readMeta}; conversation contents live
 * on {@link ConversationHandle} objects acquired on demand via
 * {@link conversation}. The lightweight conversation meta list (ids + names +
 * counts) is maintained here from openSpace + SSE. Reactive consumers (e.g. the
 * Svelte wrapper) own any cached presentation of that state; this class just
 * wraps the wire.
 *
 * Objects are addressed by machine path (`/space/.../*.json`). Conversation
 * handles carry attribution headers for WebDAV writes. Object/file reactivity
 * is exposed via `filesChanged` / `filesReset` plus WebDAV `syncCollection()`.
 */
export class SpaceOperations extends EventEmitter<RoolSpaceEvents> {
  protected _id: string;
  protected _name: string;
  protected _role: RoolUserRole;
  protected _userId: string;
  protected _closed: boolean = false;
  protected _graphqlClient: GraphQLClient;
  protected _restClient: RestClient;
  protected _webdav: RoolWebDAV;
  protected _onCloseCallback: () => void;
  protected _logger: Logger;

  // Conversation roster — lightweight meta, no interaction bodies. Maintained
  // from openSpace + SSE conversation_updated events.
  protected _conversationMeta: ConversationMeta[];

  constructor(config: SpaceOperationsConfig) {
    super();
    this._id = config.id;
    this._name = config.name;
    this._role = config.role;
    this._userId = config.userId;
    this._emitterLogger = config.logger;
    this._graphqlClient = config.graphqlClient;
    this._restClient = config.restClient;
    this._webdav = config.webdav;
    this._logger = config.logger;
    this._onCloseCallback = config.onClose;
    this._conversationMeta = config.conversationMeta;
  }

  /**
   * Handle an event from the shared space subscription.
   * Called by the client's event router.
   * @internal
   */
  _handleEvent(event: SpaceEvent): void {
    this.applySpaceContentEvent(event);
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get role(): RoolUserRole {
    return this._role;
  }

  /** Current user's ID (for identifying own interactions) */
  get userId(): string {
    return this._userId;
  }



  get isReadOnly(): boolean {
    return this._role === 'viewer';
  }


  /**
   * Lightweight conversation roster (no interaction bodies). Maintained from
   * openSpace + SSE; reactive consumers mirror this list.
   */
  getConversations(): ConversationMeta[] {
    return this._conversationMeta;
  }

  /**
   * Delete a conversation. The server confirms via SSE (`conversation_updated`
   * with a null conversation), which updates the roster and any live handle.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this._graphqlClient.deleteConversation(this._id, conversationId);
  }

  /**
   * Create a conversation under an agent. The server mints the id (unique
   * across the space's agents) and creates the folder with the requested
   * visibility; prompt the returned id to start talking.
   */
  async createConversation(agent: string, visibility: ConversationVisibility): Promise<string> {
    return this._graphqlClient.createConversation(this._id, agent, visibility);
  }

  /**
   * The space's agents (folder names under /agents). Always includes the stock
   * agent `rool`.
   */
  async listAgents(): Promise<string[]> {
    return this._graphqlClient.listAgents(this._id);
  }

  /**
   * Delete a custom agent and all its conversations. The stock agent `rool`
   * cannot be deleted.
   */
  async deleteAgent(agent: string): Promise<void> {
    await this._graphqlClient.deleteAgent(this._id, agent);
  }

  /**
   * Get a handle for a conversation. The handle holds its own interaction tree
   * + cursor; call {@link ConversationHandle.load} to fetch an existing
   * conversation's contents, or just {@link ConversationHandle.prompt} to start
   * a new one (SSE fills the tree). Consumers feed SSE updates into the handle
   * via {@link ConversationHandle.applyUpdate}.
   */
  conversation(conversationId: string): ConversationHandle {
    return new ConversationHandle(this, conversationId);
  }

  /** @internal — fetch a conversation's full contents from the server. */
  async _fetchConversationImpl(conversationId: string): Promise<Conversation | null> {
    return this._graphqlClient.getConversation(this._id, conversationId);
  }

  /**
   * Close this space session and clean up resources.
   */
  close(): void {
    this._closed = true;
    this._onCloseCallback();

    this.removeAllListeners();
  }

  /**
   * @deprecated Checkpoints are now managed by the server; this is a no-op.
   */
  async checkpoint(_label: string = 'Change'): Promise<string> {
    this._logger.warn(
      '[RoolSpace] checkpoint() is a no-op: checkpoints are now managed by the server.',
    );
    return '';
  }

  /** Check if undo is available for this space. */
  async canUndo(): Promise<boolean> {
    const status = await this._graphqlClient.checkpointStatus(this._id);
    return status.canUndo;
  }

  /** Check if redo is available for this space. */
  async canRedo(): Promise<boolean> {
    const status = await this._graphqlClient.checkpointStatus(this._id);
    return status.canRedo;
  }

  /** Restore the space to the most recent checkpoint. */
  async undo(): Promise<boolean> {
    const result = await this._graphqlClient.undo(this._id);
    return result.success;
  }

  /** Reapply the most recently undone checkpoint. */
  async redo(): Promise<boolean> {
    const result = await this._graphqlClient.redo(this._id);
    return result.success;
  }

  /**
   * @deprecated Checkpoint history is now managed by the server; this is a no-op.
   */
  async clearHistory(): Promise<void> {
    this._logger.warn(
      '[RoolSpace] clearHistory() is a no-op: checkpoint history is now managed by the server.',
    );
  }

  private davHeaders(interactionId?: string): Headers {
    const headers = new Headers();
    if (interactionId) headers.set('X-Rool-Interaction-Id', interactionId);
    return headers;
  }

  private async readObject(path: string): Promise<{ object: RoolObject; etag: string | null } | undefined> {
    const canonical = objectPath(path);
    try {
      const response = await this._webdav.get(canonical);
      const body = jsonObject(await response.json(), `Object ${canonical}`);
      return { object: objectFromBody(canonical, body), etag: response.headers.get('ETag') };
    } catch (error) {
      if (error instanceof WebDAVError && error.status === 404) return undefined;
      if (error instanceof SyntaxError) throw new Error(`Object ${canonical} did not contain valid JSON`);
      throw error;
    }
  }

  /** Get an object JSON file by machine path. Fetches from the server on each call. */
  async getObject(path: string): Promise<RoolObject | undefined> {
    return (await this.readObject(path))?.object;
  }

  /** Get object JSON files by machine path in bulk. Duplicate paths are fetched once. */
  async getObjects(paths: string[]): Promise<GetObjectsResult> {
    const canonical: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      const normalized = objectPath(path);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      canonical.push(normalized);
    }

    const result: GetObjectsResult = { objects: [], missing: [] };
    for (let i = 0; i < canonical.length; i += GET_OBJECTS_CHUNK_SIZE) {
      const chunk = canonical.slice(i, i + GET_OBJECTS_CHUNK_SIZE);
      const partial = await this._restClient.getObjects(this._id, chunk);
      result.objects.push(...partial.objects);
      result.missing.push(...partial.missing);
    }
    return result;
  }

  /** Create or replace an object JSON file. */
  async putObject(path: string, body: Record<string, unknown>): Promise<{ object: RoolObject; message: string }> {
    const canonical = objectPath(path);
    const optimistic = objectFromBody(canonical, body);

    try {
      const interactionId = generateEntityId();
      await this._webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        headers: this.davHeaders(interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Put ${canonical}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to put object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** Patch an existing object JSON file. */
  async patchObject(path: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    const canonical = objectPath(path);
    const data = options.data ?? {};
    const current = await this.readObject(canonical);
    if (!current) throw new Error(`Object ${canonical} not found`);
    const body = patchBody(current.object.body, data);
    const optimistic = objectFromBody(canonical, body);

    try {
      const interactionId = generateEntityId();
      await this._webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        ifMatch: current.etag ?? undefined,
        headers: this.davHeaders(interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Patched ${canonical}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to patch object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** Move (rename/relocate) an object. */
  async moveObject(from: string, to: string, options?: MoveObjectOptions): Promise<{ object: RoolObject; message: string }> {
    const fromPath = objectPath(from);
    const toPath = objectPath(to);
    const optimistic = objectFromBody(toPath, options?.body ?? {});

    try {
      const interactionId = generateEntityId();
      await this._webdav.move(fromPath, toPath, {
        headers: this.davHeaders(interactionId),
      });
      if (options?.body) {
        await this._webdav.put(toPath, JSON.stringify(options.body), {
          contentType: 'application/json',
          headers: this.davHeaders(interactionId),
        });
      }
      const fresh = await this.getObject(toPath) ?? optimistic;
      return { object: fresh, message: `Moved ${fromPath} to ${toPath}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to move object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** Delete object JSON files by path. */
  async deleteObjects(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const canonical = paths.map(objectPath);

    try {
      const interactionId = generateEntityId();
      for (const path of canonical) {
        await this._webdav.delete(path, {
          headers: this.davHeaders(interactionId),
        });
      }
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to delete paths:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Read space metadata from `/space/.meta.json`. Returns `{}` when the space has
   * no metadata file yet. Stateless — callers (e.g. a reactive wrapper) cache and
   * re-fetch this on their own schedule, typically when a file-tree sync reports
   * the node changed.
   */
  async readMeta(): Promise<Record<string, unknown>> {
    try {
      const response = await this._webdav.get('/space/.meta.json');
      return jsonObject(await response.json(), 'space meta');
    } catch (error) {
      if (error instanceof WebDAVError && error.status === 404) return {};
      throw error;
    }
  }

  /**
   * Write the full metadata blob to `/space/.meta.json`, attributed to a
   * conversation. Callers compose the blob (e.g. read-merge-write) — this does no
   * merging.
   */
  async writeMeta(meta: Record<string, unknown>): Promise<void> {
    await this._webdav.put('/space/.meta.json', JSON.stringify(meta), {
      contentType: 'application/json',
      headers: this.davHeaders(generateEntityId()),
    });
  }

  /**
   * Read the collection schema: one `/space/<name>/.schema.json` per collection
   * directory under `/space`. Returns `{}` for a space with no collections.
   * Stateless — reactive callers re-fetch when a `.schema.json` node changes.
   */
  async readSchema(): Promise<SpaceSchema> {
    const listing = await this._webdav.propfind('/space', { depth: '1', props: ['resourcetype'] });
    const collections = listing.responses
      .filter((r) => r.isCollection && r.path !== '/space')
      .map((r) => r.path.split('/').pop() as string);
    const entries = await Promise.all(collections.map(async (name) => {
      try {
        const response = await this._webdav.get(`/space/${name}/.schema.json`);
        return [name, jsonObject(await response.json(), `schema ${name}`)] as const;
      } catch (error) {
        if (error instanceof WebDAVError && error.status === 404) return null;
        throw error;
      }
    }));
    const schema: SpaceSchema = {};
    for (const entry of entries) if (entry) schema[entry[0]] = entry[1] as unknown as CollectionDef;
    return schema;
  }


  /** Create a new collection (MKCOL + schema JSON). */
  async createCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    const def = collectionDef(fields, options);
    await this._webdav.mkcol(collectionPath(name), { headers: this.davHeaders(generateEntityId()) });
    await this._webdav.put(schemaPath(name), JSON.stringify(def), {
      contentType: 'application/json',
      headers: this.davHeaders(generateEntityId()),
    });
    return def;
  }


  /** Alter an existing collection's schema JSON. */
  async alterCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    const def = collectionDef(fields, options);
    await this._webdav.put(schemaPath(name), JSON.stringify(def), {
      contentType: 'application/json',
      headers: this.davHeaders(generateEntityId()),
    });
    return def;
  }


  /** Drop a collection (DELETE). */
  async dropCollection(name: string): Promise<void> {
    await this._webdav.delete(collectionPath(name), { collection: true, headers: this.davHeaders(generateEntityId()) });
  }


  /** @internal */
  async _setSystemInstructionImpl(instruction: string | null, conversationId: string): Promise<void> {
    await this._graphqlClient.updateConversation(this._id, conversationId, { systemInstruction: instruction });
  }

  /** @internal */
  async _renameConversationImpl(name: string, conversationId: string): Promise<void> {
    await this._graphqlClient.updateConversation(this._id, conversationId, { name });
  }


  /** @internal */
  async _promptImpl(prompt: string, options: PromptOptions | undefined, conversationId: string): Promise<{ message: string; objects: RoolObject[]; creditsUsed: number }> {
    const { attachments, signal, interactionId = generateEntityId(), parentInteractionId = null, ...rest } = options ?? {};

    let attachmentRefs: string[] | undefined;
    if (attachments?.length) {
      attachmentRefs = await Promise.all(
        attachments.map(async (attachment) => {
          const path = typeof attachment === 'string' ? machinePath(attachment) : await this.uploadAttachment(attachment, conversationId);
          return machineUri(path);
        })
      );
    }

    let onAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        this.stopConversation(conversationId).catch(() => { });
      } else {
        onAbort = () => {
          this.stopConversation(conversationId).catch(() => { });
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let result;
    try {
      result = await this._graphqlClient.prompt(this._id, prompt, conversationId, {
        ...rest,
        attachmentRefs,
        interactionId,
        parentInteractionId,
      });
    } finally {
      if (onAbort) signal!.removeEventListener('abort', onAbort);
    }

    const objects: RoolObject[] = [];
    const fetched = await Promise.all(result.modifiedObjectPaths.map((path) => this.getObject(path)));
    for (const object of fetched) {
      if (object) objects.push(object);
    }

    return {
      message: result.message,
      objects,
      creditsUsed: result.creditsUsed,
    };
  }

  /**
   * Request that the server stop a specific in-flight interaction by ID.
   *
   * @deprecated Reaches only a prompt the server is still awaiting; use
   * {@link stopConversation}, which stops the run regardless of how or where
   * it was started.
   */
  async stopInteraction(interactionId: string): Promise<boolean> {
    return this._graphqlClient.stopInteraction(this._id, interactionId);
  }

  /**
   * Stop whatever is running in a conversation. A conversation processes one
   * run at a time, so no interaction handle is needed.
   *
   * Returns whether anything was actually running.
   */
  async stopConversation(conversationId: string): Promise<boolean> {
    return this._graphqlClient.stopConversation(this._id, conversationId);
  }

  /**
   * Fetch an external URL via the server proxy, bypassing CORS restrictions.
   */
  async fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown }
  ): Promise<Response> {
    return this._restClient.proxyFetch(this._id, url, init);
  }

  private async uploadAttachment(
    file: File | Blob | { data: string; contentType: string; filename?: string },
    conversationId: string
  ): Promise<string> {
    const attachment = attachmentBody(file);
    const path = `/rool-drive/attachments/${conversationId}/${attachment.filename}`;
    // createParents avoids racing MKCOLs when multiple attachments upload concurrently.
    await this._webdav.put(path, attachment.body, {
      contentType: attachment.contentType,
      createParents: true,
    });
    return path;
  }

  /**
   * Handle a space event from the subscription.
   * @internal
   */
  private applySpaceContentEvent(event: SpaceEvent): void {
    if (this._closed) return;
    if (event.type !== 'conversation_updated' || !event.conversationId) return;

    const changeSource = event.source === 'agent' ? 'remote_agent' : 'remote_user';
    const conversation = event.conversation ?? null;

    this._updateConversationMeta(event.conversationId, conversation);

    this.emit('conversationUpdated', {
      conversationId: event.conversationId,
      conversation,
      source: changeSource,
    });
  }

  /** Maintain the conversation meta list from an SSE update. */
  private _updateConversationMeta(id: string, conversation: Conversation | null): void {
    if (conversation === null) {
      this._conversationMeta = this._conversationMeta.filter((m) => m.id !== id);
      return;
    }
    const interactionCount = conversation.interactions ? Object.keys(conversation.interactions).length : 0;
    const entry: ConversationMeta = {
      id,
      agent: conversation.agent ?? 'rool',
      visibility: conversation.visibility ?? 'shared',
      name: conversation.name ?? null,
      systemInstruction: conversation.systemInstruction ?? null,
      createdAt: conversation.createdAt,
      createdBy: conversation.createdBy,
      interactionCount,
      updatedAt: Date.now(),
    };
    const idx = this._conversationMeta.findIndex((m) => m.id === id);
    if (idx >= 0) {
      this._conversationMeta = [
        ...this._conversationMeta.slice(0, idx),
        entry,
        ...this._conversationMeta.slice(idx + 1),
      ];
    } else {
      this._conversationMeta = [entry, ...this._conversationMeta];
    }
  }
}

/**
 * A stateful handle for a single conversation. Holds the interaction tree and a
 * client-side branch cursor (active leaf). Acquired on demand via
 * {@link SpaceOperations.conversation}; a fresh handle each call — the SDK
 * holds no handle map. The handle starts unloaded; call {@link load} to fetch
 * an existing conversation's contents, or just {@link prompt} to start a new
 * one. Feed SSE updates via {@link applyUpdate}.
 */
export class ConversationHandle {
  private _space: SpaceOperations;
  private _conversationId: string;
  private _data: Conversation | null = null;
  private _activeLeaf: string | undefined;

  /** @internal */
  constructor(space: SpaceOperations, conversationId: string) {
    this._space = space;
    this._conversationId = conversationId;
  }

  /** The conversation ID this handle is scoped to. */
  get conversationId(): string { return this._conversationId; }

  /** Whether the conversation contents have been loaded. */
  get loaded(): boolean { return this._data !== null; }

  /** Fetch the full conversation from the server. Skips the overwrite if SSE
   *  already filled the tree during the fetch (SSE is the real-time source of
   *  truth). Pass `true` to force a reload — used after a reconnect `reset`,
   *  where we may have missed SSE updates while disconnected. */
  async load(force = false): Promise<void> {
    const data = await this._space._fetchConversationImpl(this._conversationId);
    if (!force && this._data) return;
    this._data = data;
    this._activeLeaf = this._data ? findDefaultLeaf(this._data.interactions) : undefined;
  }

  /** Apply an SSE conversation update — updates the tree + cursor. Pass `null`
   *  for a deletion. */
  applyUpdate(conversation: Conversation | null): void {
    if (conversation === null) {
      this._data = null;
      this._activeLeaf = undefined;
      return;
    }
    // Advance the cursor to a new child of the current leaf, if one appeared.
    const currentLeaf = this._activeLeaf;
    if (currentLeaf) {
      for (const ix of Object.values(conversation.interactions)) {
        if (ix.parentId === currentLeaf && ix.id !== currentLeaf) {
          this._activeLeaf = ix.id;
          break;
        }
      }
    }
    this._data = conversation;
    if (this._activeLeaf === undefined) {
      this._activeLeaf = findDefaultLeaf(conversation.interactions);
    }
  }

  /** Get the active branch as a flat array (root → leaf). Empty until loaded. */
  getInteractions(): Interaction[] {
    if (!this._data) return [];
    const leaf = this._activeLeaf ?? findDefaultLeaf(this._data.interactions);
    if (!leaf) return [];
    return walkBranch(this._data.interactions, leaf);
  }

  /** Get the full interaction tree as a record. Empty until loaded. */
  getTree(): Record<string, Interaction> {
    if (!this._data) return {};
    return this._data.interactions;
  }

  /** Get the active leaf interaction ID, or undefined if empty. */
  get activeLeafId(): string | undefined {
    if (this._activeLeaf) return this._activeLeaf;
    if (!this._data) return undefined;
    return findDefaultLeaf(this._data.interactions);
  }

  /** Switch to a different branch by setting the active leaf. */
  setActiveLeaf(interactionId: string): void {
    if (!this._data || !this._data.interactions[interactionId]) {
      throw new Error(`Interaction "${interactionId}" not found in conversation "${this._conversationId}"`);
    }
    this._activeLeaf = interactionId;
  }

  /** Get the system instruction for this conversation. */
  getSystemInstruction(): string | undefined {
    return this._data?.systemInstruction;
  }

  /** Set the system instruction for this conversation. Pass null to clear. */
  async setSystemInstruction(instruction: string | null): Promise<void> {
    return this._space._setSystemInstructionImpl(instruction, this._conversationId);
  }

  /** Rename this conversation. */
  async rename(name: string): Promise<void> {
    return this._space._renameConversationImpl(name, this._conversationId);
  }

  /** Delete this conversation. */
  async delete(): Promise<void> {
    return this._space.deleteConversation(this._conversationId);
  }

  /** Send a prompt to the AI agent, scoped to this conversation's history.
   *  Auto-continues from the active leaf unless `parentInteractionId` is set. */
  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[]; creditsUsed: number }> {
    const interactionId = options?.interactionId ?? generateEntityId();
    const parentInteractionId = options?.parentInteractionId !== undefined
      ? options.parentInteractionId
      : (this.activeLeafId ?? null);
    // Optimistic: advance the cursor to the new interaction.
    this._activeLeaf = interactionId;
    return this._space._promptImpl(text, { ...options, interactionId, parentInteractionId }, this._conversationId);
  }

  /**
   * Stop this conversation's running work, if any. No-op returning `false`
   * when nothing is running. See {@link RoolSpace.stopConversation}.
   */
  async stop(): Promise<boolean> {
    return this._space.stopConversation(this._conversationId);
  }
}
