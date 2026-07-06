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
  ConversationInfo,
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
function findDefaultLeaf(interactions: Record<string, Interaction> | Interaction[] | undefined): string | undefined {
  if (!interactions || Array.isArray(interactions)) return undefined;
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
  /** Conversations keyed by ID. */
  conversations: Record<string, Conversation>;
  graphqlClient: GraphQLClient;
  restClient: RestClient;
  webdav: RoolWebDAV;
  logger: Logger;
  onClose: () => void;
}

/**
 * A thin, stateless handle over a space's raw APIs (GraphQL, WebDAV, REST) plus
 * the conversation history the server pushes over SSE. It holds no schema or
 * metadata state — those live in the filesystem (`/space/<collection>/.schema.json`,
 * `/space/.meta.json`) and are read on demand via {@link readSchema} /
 * {@link readMeta}. Reactive consumers (e.g. the Svelte wrapper) own any cached
 * presentation of that state; this class just wraps the wire.
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

  // Conversation history keyed by ID (the one piece of server-pushed state).
  protected _conversations: Record<string, Conversation>;

  // Active leaf per conversation (client-side tree cursor)
  protected _activeLeaves = new Map<string, string>();

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
    this._conversations = config.conversations;
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


  /** @internal */
  _getInteractionsImpl(conversationId: string): Interaction[] {
    const interactions = this._conversations[conversationId]?.interactions;
    if (!interactions) return [];

    // Handle legacy array format
    if (Array.isArray(interactions)) return interactions as Interaction[];

    const leafId = this._getActiveLeafImpl(conversationId);
    if (!leafId) return [];

    return walkBranch(interactions, leafId);
  }

  /** @internal */
  _getTreeImpl(conversationId: string): Record<string, Interaction> {
    const interactions = this._conversations[conversationId]?.interactions;
    if (!interactions || Array.isArray(interactions)) return {};
    return interactions;
  }

  /** @internal */
  _getActiveLeafImpl(conversationId: string): string | undefined {
    return this._activeLeaves.get(conversationId) ?? findDefaultLeaf(this._conversations[conversationId]?.interactions);
  }

  /** @internal */
  _setActiveLeafImpl(interactionId: string, conversationId: string): void {
    const interactions = this._conversations[conversationId]?.interactions;
    if (!interactions || Array.isArray(interactions) || !interactions[interactionId]) {
      throw new Error(`Interaction "${interactionId}" not found in conversation "${conversationId}"`);
    }
    this._activeLeaves.set(conversationId, interactionId);
    this.emit('conversationUpdated', {
      conversationId,
      source: 'local_user',
    });
  }

  /**
   * Get all conversations in this space.
   * Returns summary info (no full interaction data) for each conversation.
   */
  getConversations(): ConversationInfo[] {
    return Object.entries(this._conversations).map(([id, conv]) => ({
      id,
      name: conv.name ?? null,
      systemInstruction: conv.systemInstruction ?? null,
      createdAt: conv.createdAt,
      createdBy: conv.createdBy,
      interactionCount: conv.interactions ? Object.keys(conv.interactions).length : 0,
    }));
  }

  /**
   * Delete a conversation from this space.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this._graphqlClient.deleteConversation(this._id, conversationId);

    // Optimistic local update — remove from cache and emit event
    // in case the server doesn't send a conversation_updated event for deletes
    if (this._conversations[conversationId]) {
      delete this._conversations[conversationId];
      this.emit('conversationUpdated', {
        conversationId,
        source: 'local_user',
      });
    }
  }

  /**
   * Get a handle for a specific conversation.
   */
  conversation(conversationId: string): ConversationHandle {
    return new ConversationHandle(this, conversationId);
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

  private davHeaders(conversationId: string, interactionId?: string): Headers {
    const headers = new Headers({
      'X-Rool-Conversation-Id': conversationId,
    });
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

  /** @internal */
  async _putObjectImpl(path: string, body: Record<string, unknown>, conversationId: string): Promise<{ object: RoolObject; message: string }> {
    const canonical = objectPath(path);
    const optimistic = objectFromBody(canonical, body);

    try {
      const interactionId = generateEntityId();
      await this._webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        headers: this.davHeaders(conversationId, interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Put ${canonical}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to put object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** @internal */
  async _patchObjectImpl(path: string, options: UpdateObjectOptions, conversationId: string): Promise<{ object: RoolObject; message: string }> {
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
        headers: this.davHeaders(conversationId, interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Patched ${canonical}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to patch object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** @internal */
  async _moveObjectImpl(from: string, to: string, options: MoveObjectOptions | undefined, conversationId: string): Promise<{ object: RoolObject; message: string }> {
    const fromPath = objectPath(from);
    const toPath = objectPath(to);
    const optimistic = objectFromBody(toPath, options?.body ?? {});

    try {
      const interactionId = generateEntityId();
      await this._webdav.move(fromPath, toPath, {
        headers: this.davHeaders(conversationId, interactionId),
      });
      if (options?.body) {
        await this._webdav.put(toPath, JSON.stringify(options.body), {
          contentType: 'application/json',
          headers: this.davHeaders(conversationId, interactionId),
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


  /** @internal */
  async _deleteObjectsImpl(paths: string[], conversationId: string): Promise<void> {
    if (paths.length === 0) return;
    const canonical = paths.map(objectPath);

    try {
      const interactionId = generateEntityId();
      for (const path of canonical) {
        await this._webdav.delete(path, {
          headers: this.davHeaders(conversationId, interactionId),
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
  async writeMeta(meta: Record<string, unknown>, conversationId: string): Promise<void> {
    await this._webdav.put('/space/.meta.json', JSON.stringify(meta), {
      contentType: 'application/json',
      headers: this.davHeaders(conversationId, generateEntityId()),
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


  /** @internal */
  async _createCollectionImpl(name: string, fields: FieldDef[] | CollectionDef, options: CollectionOptions | undefined, conversationId: string): Promise<CollectionDef> {
    const def = collectionDef(fields, options);
    await this._webdav.mkcol(collectionPath(name), { headers: this.davHeaders(conversationId, generateEntityId()) });
    await this._webdav.put(schemaPath(name), JSON.stringify(def), {
      contentType: 'application/json',
      headers: this.davHeaders(conversationId, generateEntityId()),
    });
    return def;
  }


  /** @internal */
  async _alterCollectionImpl(name: string, fields: FieldDef[] | CollectionDef, options: CollectionOptions | undefined, conversationId: string): Promise<CollectionDef> {
    const def = collectionDef(fields, options);
    await this._webdav.put(schemaPath(name), JSON.stringify(def), {
      contentType: 'application/json',
      headers: this.davHeaders(conversationId, generateEntityId()),
    });
    return def;
  }


  /** @internal */
  async _dropCollectionImpl(name: string, conversationId: string): Promise<void> {
    await this._webdav.delete(collectionPath(name), { collection: true, headers: this.davHeaders(conversationId, generateEntityId()) });
  }


  /** @internal */
  _getSystemInstructionImpl(conversationId: string): string | undefined {
    return this._conversations[conversationId]?.systemInstruction;
  }


  /** @internal */
  async _setSystemInstructionImpl(instruction: string | null, conversationId: string): Promise<void> {
    this._ensureConversationImpl(conversationId);
    const conv = this._conversations[conversationId];
    const previousInstruction = conv.systemInstruction;
    if (instruction === null) {
      delete conv.systemInstruction;
    } else {
      conv.systemInstruction = instruction;
    }

    this.emit('conversationUpdated', {
      conversationId,
      source: 'local_user',
    });

    try {
      await this._graphqlClient.updateConversation(
        this._id,
        conversationId,
        { systemInstruction: instruction },
      );
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to set system instruction:', error);
      if (previousInstruction === undefined) {
        delete conv.systemInstruction;
      } else {
        conv.systemInstruction = previousInstruction;
      }
      throw error;
    }
  }

  /** @internal */
  async _renameConversationImpl(name: string, conversationId: string): Promise<void> {
    this._ensureConversationImpl(conversationId);
    const conv = this._conversations[conversationId];
    const previousName = conv.name;
    conv.name = name;

    this.emit('conversationUpdated', {
      conversationId,
      source: 'local_user',
    });

    try {
      await this._graphqlClient.updateConversation(
        this._id,
        conversationId,
        { name },
      );
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to rename conversation:', error);
      conv.name = previousName;
      throw error;
    }
  }

  /** @internal */
  _ensureConversationImpl(conversationId: string): void {
    if (!this._conversations[conversationId]) {
      this._conversations[conversationId] = {
        createdAt: Date.now(),
        createdBy: this._userId,
        interactions: {},
      };
    }
  }


  /** @internal */
  async _promptImpl(prompt: string, options: PromptOptions | undefined, conversationId: string): Promise<{ message: string; objects: RoolObject[] }> {
    const { attachments, parentInteractionId: explicitParent, signal, interactionId: providedId, ...rest } = options ?? {};
    // Callers may supply the id so they can render an optimistic message keyed by
    // the id the server will echo back (see PromptOptions.interactionId).
    const interactionId = providedId ?? generateEntityId();

    let attachmentRefs: string[] | undefined;
    if (attachments?.length) {
      attachmentRefs = await Promise.all(
        attachments.map(async (attachment) => {
          const path = typeof attachment === 'string' ? machinePath(attachment) : await this.uploadAttachment(attachment, conversationId);
          return machineUri(path);
        })
      );
    }

    // Auto-continue from active leaf if no explicit parent provided
    const parentInteractionId = explicitParent !== undefined
      ? explicitParent
      : (this._getActiveLeafImpl(conversationId) ?? null);

    // Optimistically set active leaf before the server call.
    this._activeLeaves.set(conversationId, interactionId);

    let onAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        this.stopInteraction(interactionId).catch(() => { });
      } else {
        onAbort = () => {
          this.stopInteraction(interactionId).catch(() => { });
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
    };
  }

  /**
   * Request that the server stop a specific in-flight interaction by ID.
   *
   * Returns whether the server stopped an interaction (`false` if it had
   * already finished). Stopping is best-effort — see {@link ConversationHandle.stop}.
   */
  async stopInteraction(interactionId: string): Promise<boolean> {
    return this._graphqlClient.stopInteraction(this._id, interactionId);
  }

  /** @internal */
  async _stopImpl(conversationId: string): Promise<boolean> {
    const leafId = this._getActiveLeafImpl(conversationId);
    if (!leafId) return false;

    const interactions = this._conversations[conversationId]?.interactions;
    const interaction = interactions && !Array.isArray(interactions) ? interactions[leafId] : undefined;
    // Skip the round trip when we already know the interaction has settled.
    if (interaction && (interaction.status === 'done' || interaction.status === 'error')) {
      return false;
    }

    return this.stopInteraction(leafId);
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

    const changeSource = event.source === 'agent' ? 'remote_agent' : 'remote_user';

    switch (event.type) {
      case 'conversation_updated':
        if (event.conversationId) {
          const prev = this._conversations[event.conversationId];
          if (event.conversation) {
            this._conversations[event.conversationId] = event.conversation;
          } else {
            delete this._conversations[event.conversationId];
          }

          if (JSON.stringify(prev) === JSON.stringify(event.conversation)) break;

          if (event.conversation && !Array.isArray(event.conversation.interactions)) {
            const currentLeaf = this._getActiveLeafImpl(event.conversationId);
            if (currentLeaf) {
              for (const ix of Object.values(event.conversation.interactions)) {
                if (ix.parentId === currentLeaf && ix.id !== currentLeaf) {
                  this._activeLeaves.set(event.conversationId, ix.id);
                  break;
                }
              }
            }
          }

          this.emit('conversationUpdated', {
            conversationId: event.conversationId,
            source: changeSource,
          });
        }
        break;
    }
  }
}

/**
 * A lightweight handle for a specific conversation.
 */
export class ConversationHandle {
  /** @internal */
  private _space: SpaceOperations;
  private _conversationId: string;

  /** @internal */
  constructor(space: SpaceOperations, conversationId: string) {
    this._space = space;
    this._conversationId = conversationId;
  }

  /** The conversation ID this handle is scoped to. */
  get conversationId(): string { return this._conversationId; }

  /** Get the active branch of this conversation as a flat array (root → leaf). */
  getInteractions(): Interaction[] {
    return this._space._getInteractionsImpl(this._conversationId);
  }

  /** Get the full interaction tree as a record. */
  getTree(): Record<string, Interaction> {
    return this._space._getTreeImpl(this._conversationId);
  }

  /** Get the active leaf interaction ID, or undefined if empty. */
  get activeLeafId(): string | undefined {
    return this._space._getActiveLeafImpl(this._conversationId);
  }

  /** Switch to a different branch by setting the active leaf. */
  setActiveLeaf(interactionId: string): void {
    this._space._setActiveLeafImpl(interactionId, this._conversationId);
  }

  /** Get the system instruction for this conversation. */
  getSystemInstruction(): string | undefined {
    return this._space._getSystemInstructionImpl(this._conversationId);
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

  /** Create or replace an object JSON file. */
  async putObject(path: string, body: Record<string, unknown>): Promise<{ object: RoolObject; message: string }> {
    return this._space._putObjectImpl(path, body, this._conversationId);
  }

  /** Patch an existing object JSON file. */
  async patchObject(path: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._space._patchObjectImpl(path, options, this._conversationId);
  }

  /** Move (rename/relocate) an object. */
  async moveObject(from: string, to: string, options?: MoveObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._space._moveObjectImpl(from, to, options, this._conversationId);
  }

  /** Delete object JSON files by path. */
  async deleteObjects(paths: string[]): Promise<void> {
    return this._space._deleteObjectsImpl(paths, this._conversationId);
  }

  /** @deprecated Use deleteObjects instead. */
  async deletePaths(paths: string[]): Promise<void> {
    return this.deleteObjects(paths);
  }

  /** Send a prompt to the AI agent, scoped to this conversation's history. */
  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._space._promptImpl(text, options, this._conversationId);
  }

  /**
   * Stop this conversation's in-flight interaction, if any. No-op returning
   * `false` when nothing is running. Stopping is best-effort — see
   * {@link RoolSpace.stopInteraction}.
   */
  async stop(): Promise<boolean> {
    return this._space._stopImpl(this._conversationId);
  }

  /** Create a new collection schema. */
  async createCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    return this._space._createCollectionImpl(name, fields, options, this._conversationId);
  }

  /** Alter an existing collection schema. */
  async alterCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    return this._space._alterCollectionImpl(name, fields, options, this._conversationId);
  }

  /** Drop a collection schema. */
  async dropCollection(name: string): Promise<void> {
    return this._space._dropCollectionImpl(name, this._conversationId);
  }
}
