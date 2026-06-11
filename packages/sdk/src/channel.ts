import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient } from './graphql.js';
import type { RestClient } from './rest.js';
import { WebDAVError, type RoolWebDAV } from './webdav.js';
import type { Logger } from './logger.js';
import type {
  RoolObject,
  GetObjectsResult,
  RoolObjectStat,
  ChannelEvents,
  RoolUserRole,
  PromptOptions,
  UpdateObjectOptions,
  MoveObjectOptions,
  ChannelEvent,
  Interaction,
  Channel,
  ConversationInfo,
  LinkAccess,
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

export interface ChannelConfig {
  id: string;
  name: string;
  role: RoolUserRole;
  linkAccess: LinkAccess;
  /** Current user's ID (for identifying own interactions) */
  userId: string;
  /** Object stats keyed by path */
  objectStats: Record<string, RoolObjectStat>;
  /** Collection schema */
  schema: SpaceSchema;
  /** Space metadata */
  meta: Record<string, unknown>;
  /** This channel's data (undefined if new) */
  channel: Channel | undefined;
  /** Channel ID for this channel (required). */
  channelId: string;
  graphqlClient: GraphQLClient;
  restClient: RestClient;
  webdav: RoolWebDAV;
  logger: Logger;
  onClose: () => void;
}

/**
 * A channel is a space + channelId pair.
 *
 * All object operations go through a channel. The channelId is fixed
 * at open time and cannot be changed. To use a different channel,
 * open a second one.
 *
 * Objects are addressed by machine path (`/space/.../*.json`).
 * Only schema, metadata, object stats, and the channel's own history are cached
 * locally. Object bodies are fetched on demand. Object/file reactivity is
 * exposed at the space level via WebDAV sync notifications.
 */
export class RoolChannel extends EventEmitter<ChannelEvents> {
  private _id: string;
  private _name: string;
  private _role: RoolUserRole;
  private _linkAccess: LinkAccess;
  private _userId: string;
  private _channelId: string;
  private _conversationId: string;
  private _closed: boolean = false;
  private graphqlClient: GraphQLClient;
  private restClient: RestClient;
  private webdav: RoolWebDAV;
  private onCloseCallback: () => void;
  private logger: Logger;

  // Local cache for bounded data (schema, metadata, own channel, object stats)
  private _meta: Record<string, unknown>;
  private _schema: SpaceSchema;
  private _channel: Channel | undefined;
  private _objectStats: Map<string, RoolObjectStat>;

  // Active leaf per conversation (client-side tree cursor)
  private _activeLeaves = new Map<string, string>();

  constructor(config: ChannelConfig) {
    super();
    this._id = config.id;
    this._name = config.name;
    this._role = config.role;
    this._linkAccess = config.linkAccess;
    this._userId = config.userId;
    this._emitterLogger = config.logger;
    this._channelId = config.channelId;
    this._conversationId = 'default';
    this.graphqlClient = config.graphqlClient;
    this.restClient = config.restClient;
    this.webdav = config.webdav;
    this.logger = config.logger;
    this.onCloseCallback = config.onClose;

    // Initialize local cache from server data
    this._meta = config.meta;
    this._schema = config.schema;
    this._channel = config.channel ?? undefined;
    this._objectStats = new Map(Object.entries(config.objectStats));
  }

  /**
   * Handle an event from the shared space subscription.
   * Called by the client's event router.
   * @internal
   */
  _handleEvent(event: ChannelEvent): void {
    this.handleChannelEvent(event);
  }

  /**
   * Apply resync data after reconnection. Called by the client, which
   * fetches space data once and distributes to all channels.
   * @internal
   */
  _applyResyncData(data: {
    meta: Record<string, unknown>;
    schema: SpaceSchema;
    objectStats: Record<string, RoolObjectStat>;
    channel: Channel | undefined;
  }): void {
    if (this._closed) return;
    this._meta = data.meta;
    this._schema = data.schema;
    this._objectStats = new Map(Object.entries(data.objectStats));
    if (data.channel) this._channel = data.channel;
    this._activeLeaves.clear();
    this.emit('reset', { source: 'system' });
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

  get linkAccess(): LinkAccess {
    return this._linkAccess;
  }

  /** Current user's ID (for identifying own interactions) */
  get userId(): string {
    return this._userId;
  }

  /**
   * Get the channel's display name, or null if not set.
   */
  get channelName(): string | null {
    return this._channel?.name ?? null;
  }

  /**
   * Get the channel ID for this channel.
   * Fixed at open time — cannot be changed.
   */
  get channelId(): string {
    return this._channelId;
  }

  /**
   * Get the conversation ID for this channel.
   * Defaults to 'default' for most apps.
   */
  get conversationId(): string {
    return this._conversationId;
  }

  get isReadOnly(): boolean {
    return this._role === 'viewer';
  }


  /**
   * Get the active branch of the current conversation as a flat array (root → leaf).
   * Walks from the active leaf up through parentId pointers.
   */
  getInteractions(): Interaction[] {
    return this._getInteractionsImpl(this._conversationId);
  }

  /** @internal */
  _getInteractionsImpl(conversationId: string): Interaction[] {
    const interactions = this._channel?.conversations[conversationId]?.interactions;
    if (!interactions) return [];

    // Handle legacy array format
    if (Array.isArray(interactions)) return interactions as Interaction[];

    const leafId = this._getActiveLeafImpl(conversationId);
    if (!leafId) return [];

    return walkBranch(interactions, leafId);
  }

  /**
   * Get the full interaction tree for a conversation as a record.
   * For clients that need to render branch navigation UI.
   */
  getTree(): Record<string, Interaction> {
    return this._getTreeImpl(this._conversationId);
  }

  /** @internal */
  _getTreeImpl(conversationId: string): Record<string, Interaction> {
    const interactions = this._channel?.conversations[conversationId]?.interactions;
    if (!interactions || Array.isArray(interactions)) return {};
    return interactions;
  }

  /**
   * Get the active leaf interaction ID for a conversation.
   * Returns undefined if the conversation has no interactions.
   */
  get activeLeafId(): string | undefined {
    return this._getActiveLeafImpl(this._conversationId);
  }

  /** @internal */
  _getActiveLeafImpl(conversationId: string): string | undefined {
    return this._activeLeaves.get(conversationId) ?? findDefaultLeaf(this._channel?.conversations[conversationId]?.interactions);
  }

  /**
   * Set the active leaf for a conversation (switch branches).
   * Emits a conversationUpdated event so reactive wrappers refresh.
   */
  setActiveLeaf(interactionId: string): void {
    this._setActiveLeafImpl(interactionId, this._conversationId);
  }

  /** @internal */
  _setActiveLeafImpl(interactionId: string, conversationId: string): void {
    const interactions = this._channel?.conversations[conversationId]?.interactions;
    if (!interactions || Array.isArray(interactions) || !interactions[interactionId]) {
      throw new Error(`Interaction "${interactionId}" not found in conversation "${conversationId}"`);
    }
    this._activeLeaves.set(conversationId, interactionId);
    this.emit('conversationUpdated', {
      conversationId,
      channelId: this._channelId,
      source: 'local_user',
    });
  }

  /**
   * Get all conversations in this channel.
   * Returns summary info (no full interaction data) for each conversation.
   */
  getConversations(): ConversationInfo[] {
    if (!this._channel) return [];
    return Object.entries(this._channel.conversations).map(([id, conv]) => ({
      id,
      name: conv.name ?? null,
      systemInstruction: conv.systemInstruction ?? null,
      createdAt: conv.createdAt,
      createdBy: conv.createdBy,
      interactionCount: conv.interactions ? Object.keys(conv.interactions).length : 0,
    }));
  }

  /**
   * Delete a conversation from this channel.
   * Cannot delete the conversation you are currently using.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    if (conversationId === this._conversationId) {
      throw new Error('Cannot delete the active conversation');
    }
    await this.graphqlClient.deleteConversation(this._id, this._channelId, conversationId);

    // Optimistic local update — remove from cache and emit event
    // in case the server doesn't send a conversation_updated event for deletes
    if (this._channel?.conversations[conversationId]) {
      delete this._channel.conversations[conversationId];
      this.emit('conversationUpdated', {
        conversationId,
        channelId: this._channelId,
        source: 'local_user',
      });
    }
  }

  /**
   * Get a handle for a specific conversation within this channel.
   */
  conversation(conversationId: string): ConversationHandle {
    return new ConversationHandle(this, conversationId);
  }

  /**
   * Close this channel and clean up resources.
   * Stops real-time subscription and unregisters from client.
   */
  close(): void {
    this._closed = true;
    this.onCloseCallback();

    this.removeAllListeners();
  }

  /**
   * Create a checkpoint of the current space state.
   */
  async checkpoint(label: string = 'Change'): Promise<string> {
    const result = await this.graphqlClient.checkpoint(
      this._id,
      label,
      this._channelId,
    );
    return result.checkpointId;
  }

  /** Check if undo is available for this space. */
  async canUndo(): Promise<boolean> {
    const status = await this.graphqlClient.checkpointStatus(this._id, this._channelId);
    return status.canUndo;
  }

  /** Check if redo is available for this space. */
  async canRedo(): Promise<boolean> {
    const status = await this.graphqlClient.checkpointStatus(this._id, this._channelId);
    return status.canRedo;
  }

  /** Restore the space to the most recent checkpoint. */
  async undo(): Promise<boolean> {
    const result = await this.graphqlClient.undo(this._id, this._channelId);
    return result.success;
  }

  /** Reapply the most recently undone checkpoint. */
  async redo(): Promise<boolean> {
    const result = await this.graphqlClient.redo(this._id, this._channelId);
    return result.success;
  }

  /** Clear the space's checkpoint history. */
  async clearHistory(): Promise<void> {
    await this.graphqlClient.clearCheckpointHistory(this._id, this._channelId);
  }

  private davHeaders(conversationId: string, interactionId?: string): Headers {
    const headers = new Headers({
      'X-Rool-Channel-Id': this._channelId,
      'X-Rool-Conversation-Id': conversationId,
    });
    if (interactionId) headers.set('X-Rool-Interaction-Id', interactionId);
    return headers;
  }

  private async readObject(path: string): Promise<{ object: RoolObject; etag: string | null } | undefined> {
    const canonical = objectPath(path);
    try {
      const response = await this.webdav.get(canonical);
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
      const partial = await this.restClient.getObjects(this._id, chunk);
      result.objects.push(...partial.objects);
      result.missing.push(...partial.missing);
    }
    return result;
  }

  /** Get an object's cached audit information. */
  stat(path: string): RoolObjectStat | undefined {
    return this._objectStats.get(objectPath(path));
  }

  /** Create or replace an object JSON file at an exact machine path. */
  async putObject(path: string, body: Record<string, unknown>): Promise<{ object: RoolObject; message: string }> {
    return this._putObjectImpl(path, body, this._conversationId);
  }

  /** @internal */
  async _putObjectImpl(path: string, body: Record<string, unknown>, conversationId: string): Promise<{ object: RoolObject; message: string }> {
    const canonical = objectPath(path);
    const optimistic = objectFromBody(canonical, body);

    try {
      const interactionId = generateEntityId();
      await this.webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        headers: this.davHeaders(conversationId, interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Put ${canonical}` };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to put object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /** Patch an existing object. Null or undefined deletes a field. */
  async patchObject(path: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._patchObjectImpl(path, options, this._conversationId);
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
      await this.webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        ifMatch: current.etag ?? undefined,
        headers: this.davHeaders(conversationId, interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Patched ${canonical}` };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to patch object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /** Move an object JSON file to a new machine path, optionally replacing its body. */
  async moveObject(from: string, to: string, options?: MoveObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._moveObjectImpl(from, to, options, this._conversationId);
  }

  /** @internal */
  async _moveObjectImpl(from: string, to: string, options: MoveObjectOptions | undefined, conversationId: string): Promise<{ object: RoolObject; message: string }> {
    const fromPath = objectPath(from);
    const toPath = objectPath(to);
    const optimistic = objectFromBody(toPath, options?.body ?? {});

    try {
      const interactionId = generateEntityId();
      await this.webdav.move(fromPath, toPath, {
        headers: this.davHeaders(conversationId, interactionId),
      });
      if (options?.body) {
        await this.webdav.put(toPath, JSON.stringify(options.body), {
          contentType: 'application/json',
          headers: this.davHeaders(conversationId, interactionId),
        });
      }
      this._objectStats.delete(fromPath);
      const fresh = await this.getObject(toPath) ?? optimistic;
      return { object: fresh, message: `Moved ${fromPath} to ${toPath}` };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to move object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /** Delete object JSON files by machine path. */
  async deleteObjects(paths: string[]): Promise<void> {
    return this._deleteObjectsImpl(paths, this._conversationId);
  }

  /** @deprecated Use deleteObjects instead. */
  async deletePaths(paths: string[]): Promise<void> {
    return this.deleteObjects(paths);
  }

  /** @internal */
  async _deleteObjectsImpl(paths: string[], conversationId: string): Promise<void> {
    if (paths.length === 0) return;
    const canonical = paths.map(objectPath);

    try {
      const interactionId = generateEntityId();
      for (const path of canonical) {
        await this.webdav.delete(path, {
          headers: this.davHeaders(conversationId, interactionId),
        });
        this._objectStats.delete(path);
      }
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to delete paths:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /** Get the current schema for this space. */
  getSchema(): SpaceSchema {
    return this._schema;
  }

  /** Create a new collection schema. */
  async createCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    return this._createCollectionImpl(name, fields, options, this._conversationId);
  }

  /** @internal */
  async _createCollectionImpl(name: string, fields: FieldDef[] | CollectionDef, options: CollectionOptions | undefined, conversationId: string): Promise<CollectionDef> {
    if (this._schema[name]) {
      throw new Error(`Collection "${name}" already exists`);
    }

    // Optimistic local update
    const optimisticDef = collectionDef(fields, options);
    this._schema[name] = optimisticDef;

    try {
      await this.webdav.mkcol(collectionPath(name), { headers: this.davHeaders(conversationId, generateEntityId()) });
      await this.webdav.put(schemaPath(name), JSON.stringify(optimisticDef), {
        contentType: 'application/json',
        headers: this.davHeaders(conversationId, generateEntityId()),
      });
      this.emit('schemaUpdated', { schema: this._schema, source: 'local_user' });
      return optimisticDef;
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to create collection:', error);
      delete this._schema[name];
      throw error;
    }
  }

  /** Alter an existing collection schema, replacing its field definitions. */
  async alterCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    return this._alterCollectionImpl(name, fields, options, this._conversationId);
  }

  /** @internal */
  async _alterCollectionImpl(name: string, fields: FieldDef[] | CollectionDef, options: CollectionOptions | undefined, conversationId: string): Promise<CollectionDef> {
    if (!this._schema[name]) {
      throw new Error(`Collection "${name}" not found`);
    }

    const previous = this._schema[name];
    this._schema[name] = collectionDef(fields, options);

    try {
      const updated = this._schema[name];
      await this.webdav.put(schemaPath(name), JSON.stringify(updated), {
        contentType: 'application/json',
        headers: this.davHeaders(conversationId, generateEntityId()),
      });
      this.emit('schemaUpdated', { schema: this._schema, source: 'local_user' });
      return updated;
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to alter collection:', error);
      this._schema[name] = previous;
      throw error;
    }
  }

  /** Drop a collection schema. */
  async dropCollection(name: string): Promise<void> {
    return this._dropCollectionImpl(name, this._conversationId);
  }

  /** @internal */
  async _dropCollectionImpl(name: string, conversationId: string): Promise<void> {
    if (!this._schema[name]) {
      throw new Error(`Collection "${name}" not found`);
    }

    const previous = this._schema[name];
    delete this._schema[name];

    try {
      await this.webdav.delete(collectionPath(name), { collection: true, headers: this.davHeaders(conversationId, generateEntityId()) });
      this.emit('schemaUpdated', { schema: this._schema, source: 'local_user' });
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to drop collection:', error);
      this._schema[name] = previous;
      throw error;
    }
  }

  /**
   * Get the system instruction for the current conversation.
   */
  getSystemInstruction(): string | undefined {
    return this._getSystemInstructionImpl(this._conversationId);
  }

  /** @internal */
  _getSystemInstructionImpl(conversationId: string): string | undefined {
    return this._channel?.conversations[conversationId]?.systemInstruction;
  }

  /** Set the system instruction for the current conversation. */
  async setSystemInstruction(instruction: string | null): Promise<void> {
    return this._setSystemInstructionImpl(instruction, this._conversationId);
  }

  /** @internal */
  async _setSystemInstructionImpl(instruction: string | null, conversationId: string): Promise<void> {
    this._ensureConversationImpl(conversationId);
    const conv = this._channel!.conversations[conversationId];
    const previousInstruction = conv.systemInstruction;
    if (instruction === null) {
      delete conv.systemInstruction;
    } else {
      conv.systemInstruction = instruction;
    }

    this.emit('conversationUpdated', {
      conversationId,
      channelId: this._channelId,
      source: 'local_user',
    });
    if (conversationId === this._conversationId) {
      this.emit('channelUpdated', {
        channelId: this._channelId,
        source: 'local_user',
      });
    }

    try {
      await this.graphqlClient.updateConversation(
        this._id,
        this._channelId,
        conversationId,
        { systemInstruction: instruction },
      );
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to set system instruction:', error);
      if (previousInstruction === undefined) {
        delete conv.systemInstruction;
      } else {
        conv.systemInstruction = previousInstruction;
      }
      throw error;
    }
  }

  /** Rename the current conversation. */
  async renameConversation(name: string): Promise<void> {
    return this._renameConversationImpl(name, this._conversationId);
  }

  /** @internal */
  async _renameConversationImpl(name: string, conversationId: string): Promise<void> {
    this._ensureConversationImpl(conversationId);
    const conv = this._channel!.conversations[conversationId];
    const previousName = conv.name;
    conv.name = name;

    this.emit('conversationUpdated', {
      conversationId,
      channelId: this._channelId,
      source: 'local_user',
    });
    if (conversationId === this._conversationId) {
      this.emit('channelUpdated', {
        channelId: this._channelId,
        source: 'local_user',
      });
    }

    try {
      await this.graphqlClient.updateConversation(
        this._id,
        this._channelId,
        conversationId,
        { name },
      );
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to rename conversation:', error);
      conv.name = previousName;
      throw error;
    }
  }

  /** @internal */
  _ensureConversationImpl(conversationId: string): void {
    if (!this._channel) {
      this._channel = {
        createdAt: Date.now(),
        createdBy: this._userId,
        conversations: {},
      };
    }
    if (!this._channel.conversations[conversationId]) {
      this._channel.conversations[conversationId] = {
        createdAt: Date.now(),
        createdBy: this._userId,
        interactions: {},
      };
    }
  }

  /** Set a space-level metadata value. */
  setMetadata(key: string, value: unknown): void {
    this._setMetadataImpl(key, value, this._conversationId);
  }

  /** @internal */
  _setMetadataImpl(key: string, value: unknown, conversationId: string): void {
    this._meta[key] = value;
    this.emit('metadataUpdated', { metadata: this._meta, source: 'local_user' });

    // Fire-and-forget server call
    this.graphqlClient.setSpaceMeta(this._id, this._meta, this._channelId, conversationId)
      .catch((error) => {
        this.logger.error('[RoolChannel] Failed to set meta:', error);
      });
  }

  /** Get a space-level metadata value. */
  getMetadata(key: string): unknown {
    return this._meta[key];
  }

  /** Get all space-level metadata. */
  getAllMetadata(): Record<string, unknown> {
    return this._meta;
  }

  /**
   * Send a prompt to the AI agent for space manipulation.
   * @returns The message from the AI and the list of objects that were created or modified.
   */
  async prompt(prompt: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._promptImpl(prompt, options, this._conversationId);
  }

  /** @internal */
  async _promptImpl(prompt: string, options: PromptOptions | undefined, conversationId: string): Promise<{ message: string; objects: RoolObject[] }> {
    const { attachments, parentInteractionId: explicitParent, signal, ...rest } = options ?? {};
    const interactionId = generateEntityId();

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
      result = await this.graphqlClient.prompt(this._id, prompt, this._channelId, conversationId, {
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
   * Stop the in-flight interaction on the default conversation, if any.
   *
   * No-op returning `false` when the active leaf is already finished or the
   * conversation has no interactions. Stopping is best-effort: the server
   * halts the agent loop and closes the stream, but an LLM turn already in
   * flight keeps generating server-side and is billed.
   */
  async stop(): Promise<boolean> {
    return this._stopImpl(this._conversationId);
  }

  /**
   * Request that the server stop a specific in-flight interaction by ID.
   *
   * Returns whether the server stopped an interaction (`false` if it had
   * already finished). Stopping is best-effort — see {@link stop}.
   */
  async stopInteraction(interactionId: string): Promise<boolean> {
    return this.graphqlClient.stopInteraction(this._id, interactionId);
  }

  /** @internal */
  async _stopImpl(conversationId: string): Promise<boolean> {
    const leafId = this._getActiveLeafImpl(conversationId);
    if (!leafId) return false;

    const interactions = this._channel?.conversations[conversationId]?.interactions;
    const interaction = interactions && !Array.isArray(interactions) ? interactions[leafId] : undefined;
    // Skip the round trip when we already know the interaction has settled.
    if (interaction && (interaction.status === 'done' || interaction.status === 'error')) {
      return false;
    }

    return this.stopInteraction(leafId);
  }

  /** Rename this channel. */
  async rename(newName: string): Promise<void> {
    const previousName = this._channel?.name;
    if (this._channel) {
      this._channel.name = newName;
    }
    this.emit('channelUpdated', { channelId: this._channelId, source: 'local_user' });

    try {
      await this.graphqlClient.renameChannel(this._id, this._channelId, newName);
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to rename channel:', error);
      if (this._channel) {
        this._channel.name = previousName;
      }
      throw error;
    }
  }

  /**
   * Fetch an external URL via the server proxy, bypassing CORS restrictions.
   */
  async fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown }
  ): Promise<Response> {
    return this.restClient.proxyFetch(this._id, url, init);
  }

  private async uploadAttachment(
    file: File | Blob | { data: string; contentType: string; filename?: string },
    conversationId: string
  ): Promise<string> {
    await this.ensureCollection('/rool-drive/attachments');
    const directory = `/rool-drive/attachments/${conversationId}`;
    await this.ensureCollection(directory);

    const attachment = attachmentBody(file);
    const path = `${directory}/${attachment.filename}`;
    await this.webdav.put(path, attachment.body, { contentType: attachment.contentType });
    return path;
  }

  private async ensureCollection(path: string): Promise<void> {
    const response = await this.webdav.request('MKCOL', path, { collection: true });
    if (response.status === 201 || response.status === 405) return;
    throw new Error(`Failed to create collection ${path}: ${response.status} ${await response.text()}`);
  }

  /**
   * Handle a channel event from the subscription.
   * @internal
   */
  private handleChannelEvent(event: ChannelEvent): void {
    if (this._closed) return;

    const changeSource = event.source === 'agent' ? 'remote_agent' : 'remote_user';

    switch (event.type) {
      case 'connected':
        // Resync is handled by the client via _applyResyncData.
        break;

      case 'schema_updated':
        if (event.schema) {
          this._schema = event.schema;
          this.emit('schemaUpdated', { schema: this._schema, source: changeSource });
        }
        break;

      case 'metadata_updated':
        if (event.metadata) {
          this._meta = event.metadata;
          this.emit('metadataUpdated', { metadata: this._meta, source: changeSource });
        }
        break;

      case 'channel_updated':
        if (event.channelId === this._channelId && event.channel) {
          const changed = JSON.stringify(this._channel) !== JSON.stringify(event.channel);
          this._channel = event.channel;
          if (changed) {
            this.emit('channelUpdated', { channelId: event.channelId, source: changeSource });
          }
        }
        break;

      case 'channel_deleted':
        if (event.channelId === this._channelId) {
          this._channel = undefined;
          this._activeLeaves.clear();
          this.emit('reset', { source: changeSource });
        }
        break;

      case 'conversation_updated':
        if (event.channelId === this._channelId && event.conversationId) {
          if (!this._channel) {
            this._channel = {
              createdAt: Date.now(),
              createdBy: this._userId,
              conversations: {},
            };
          }

          const prev = this._channel.conversations[event.conversationId];
          if (event.conversation) {
            this._channel.conversations[event.conversationId] = event.conversation;
          } else {
            delete this._channel.conversations[event.conversationId];
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
            channelId: event.channelId,
            source: changeSource,
          });

          if (event.conversationId === this._conversationId) {
            this.emit('channelUpdated', { channelId: event.channelId, source: changeSource });
          }
        }
        break;

      case 'space_changed':
        // Resync is handled by the client via _applyResyncData.
        break;
    }
  }
}

/**
 * A lightweight handle for a specific conversation within a channel.
 */
export class ConversationHandle {
  /** @internal */
  private _channel: RoolChannel;
  private _conversationId: string;

  /** @internal */
  constructor(channel: RoolChannel, conversationId: string) {
    this._channel = channel;
    this._conversationId = conversationId;
  }

  /** The conversation ID this handle is scoped to. */
  get conversationId(): string { return this._conversationId; }

  /** Get the active branch of this conversation as a flat array (root → leaf). */
  getInteractions(): Interaction[] {
    return this._channel._getInteractionsImpl(this._conversationId);
  }

  /** Get the full interaction tree as a record. */
  getTree(): Record<string, Interaction> {
    return this._channel._getTreeImpl(this._conversationId);
  }

  /** Get the active leaf interaction ID, or undefined if empty. */
  get activeLeafId(): string | undefined {
    return this._channel._getActiveLeafImpl(this._conversationId);
  }

  /** Switch to a different branch by setting the active leaf. */
  setActiveLeaf(interactionId: string): void {
    this._channel._setActiveLeafImpl(interactionId, this._conversationId);
  }

  /** Get the system instruction for this conversation. */
  getSystemInstruction(): string | undefined {
    return this._channel._getSystemInstructionImpl(this._conversationId);
  }

  /** Set the system instruction for this conversation. Pass null to clear. */
  async setSystemInstruction(instruction: string | null): Promise<void> {
    return this._channel._setSystemInstructionImpl(instruction, this._conversationId);
  }

  /** Rename this conversation. */
  async rename(name: string): Promise<void> {
    return this._channel._renameConversationImpl(name, this._conversationId);
  }

  /** Create or replace an object JSON file. */
  async putObject(path: string, body: Record<string, unknown>): Promise<{ object: RoolObject; message: string }> {
    return this._channel._putObjectImpl(path, body, this._conversationId);
  }

  /** Patch an existing object JSON file. */
  async patchObject(path: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._channel._patchObjectImpl(path, options, this._conversationId);
  }

  /** Move (rename/relocate) an object. */
  async moveObject(from: string, to: string, options?: MoveObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._channel._moveObjectImpl(from, to, options, this._conversationId);
  }

  /** Delete object JSON files by path. */
  async deleteObjects(paths: string[]): Promise<void> {
    return this._channel._deleteObjectsImpl(paths, this._conversationId);
  }

  /** @deprecated Use deleteObjects instead. */
  async deletePaths(paths: string[]): Promise<void> {
    return this.deleteObjects(paths);
  }

  /** Send a prompt to the AI agent, scoped to this conversation's history. */
  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._channel._promptImpl(text, options, this._conversationId);
  }

  /**
   * Stop this conversation's in-flight interaction, if any. No-op returning
   * `false` when nothing is running. Stopping is best-effort — see
   * {@link RoolChannel.stop}.
   */
  async stop(): Promise<boolean> {
    return this._channel._stopImpl(this._conversationId);
  }

  /** Create a new collection schema. */
  async createCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    return this._channel._createCollectionImpl(name, fields, options, this._conversationId);
  }

  /** Alter an existing collection schema. */
  async alterCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    return this._channel._alterCollectionImpl(name, fields, options, this._conversationId);
  }

  /** Drop a collection schema. */
  async dropCollection(name: string): Promise<void> {
    return this._channel._dropCollectionImpl(name, this._conversationId);
  }

  setMetadata(key: string, value: unknown): void {
    return this._channel._setMetadataImpl(key, value, this._conversationId);
  }
}
