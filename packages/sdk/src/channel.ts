import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient } from './graphql.js';
import type { RestClient } from './rest.js';
import { WebDAVError, type RoolWebDAV } from './webdav.js';
import type { Logger } from './logger.js';
import type {
  RoolObject,
  RoolObjectStat,
  ChannelEvents,
  RoolUserRole,
  PromptOptions,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  MoveObjectOptions,
  ChangeSource,
  ChannelEvent,
  Interaction,
  Channel,
  ConversationInfo,
  LinkAccess,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  ExtensionManifest,
} from './types.js';
import { generateBasename, loc, normalizeLocation, parseLocation } from './locations.js';
import { resolveMachineResource, type MachineResource } from './machine.js';

// 6-character alphanumeric ID — used for interactionIds, conversationIds, etc.
const ENTITY_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

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

function objectDavPath(location: string): string {
  parseLocation(location);
  return location;
}

function collectionDavPath(name: string): string {
  parseLocation(loc(name, 'schema')); // Reuse collection validation.
  return `/space/${name}/`;
}

function schemaDavPath(name: string): string {
  return `${collectionDavPath(name)}.schema.json`;
}

function objectFromBody(location: string, body: Record<string, unknown>): RoolObject {
  const { collection, basename } = parseLocation(location);
  return { location, collection, basename, body };
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

function sameJsonValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  /** Object locations in the space (sorted by modifiedAt desc) */
  objectLocations: string[];
  /** Object stats keyed by location */
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
 * Objects are addressed by location (`/space/<collection>/<basename>.json`).
 * Only schema, metadata, the live object location list, and the channel's own
 * history are cached locally. Object bodies are fetched on demand. Changes
 * arrive via SSE semantic events and are emitted as SDK events.
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

  // Local cache for bounded data (schema, metadata, own channel, object locations, stats)
  private _meta: Record<string, unknown>;
  private _schema: SpaceSchema;
  private _channel: Channel | undefined;
  private _objectLocations: string[];
  private _objectStats: Map<string, RoolObjectStat>;

  // Active leaf per conversation (client-side tree cursor)
  private _activeLeaves = new Map<string, string>();

  // Object collection: tracks pending local mutations (by location) for dedup
  // Maps location → optimistic object (for create/update) or null (for delete)
  private _pendingMutations = new Map<string, RoolObject | null>();

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
    this._channel = config.channel;
    this._objectLocations = config.objectLocations;
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
    objectLocations: string[];
    objectStats: Record<string, RoolObjectStat>;
    channel: Channel | undefined;
  }): void {
    if (this._closed) return;
    this._meta = data.meta;
    this._schema = data.schema;
    this._objectLocations = data.objectLocations;
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
   * Get the extension URL if this channel was created via installExtension, or null.
   */
  get extensionUrl(): string | null {
    return this._channel?.extensionUrl ?? null;
  }

  /**
   * Get the extension ID if this channel has an installed extension, or null.
   */
  get extensionId(): string | null {
    return this._channel?.extensionId ?? null;
  }

  /**
   * Get the extension manifest if this channel has an installed extension, or null.
   */
  get manifest(): ExtensionManifest | null {
    return this._channel?.manifest ?? null;
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

    this._pendingMutations.clear();

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

  private async readObject(location: string): Promise<{ object: RoolObject; etag: string | null } | undefined> {
    const canonical = normalizeLocation(location);
    try {
      const response = await this.webdav.get(objectDavPath(canonical));
      const body = jsonObject(await response.json(), `Object ${canonical}`);
      return { object: objectFromBody(canonical, body), etag: response.headers.get('ETag') };
    } catch (error) {
      if (error instanceof WebDAVError && error.status === 404) return undefined;
      if (error instanceof SyntaxError) throw new Error(`Object ${canonical} did not contain valid JSON`);
      throw error;
    }
  }

  /**
   * Get an object by location. Fetches from the server on each call.
   *
   * Accepts either the canonical form (`/space/<collection>/<basename>.json`)
   * or the short form (`<collection>/<basename>`).
   */
  async getObject(location: string): Promise<RoolObject | undefined> {
    return (await this.readObject(location))?.object;
  }

  /**
   * Get an object's stat (audit information).
   * Returns the cached stat or undefined if not known.
   */
  stat(location: string): RoolObjectStat | undefined {
    return this._objectStats.get(normalizeLocation(location));
  }

  /**
   * Find objects using structured filters and/or natural language.
   */
  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this._findObjectsImpl(options, this._conversationId);
  }

  /** @internal */
  async _findObjectsImpl(options: FindObjectsOptions, _conversationId: string): Promise<{ objects: RoolObject[]; message: string }> {
    const requestedLocations = options.locations?.map(normalizeLocation);
    let locations = requestedLocations ?? this._objectLocations;
    if (options.collection) {
      locations = locations.filter((location) => parseLocation(location).collection === options.collection);
    }
    if (options.order === 'asc') locations = [...locations].reverse();

    const objects: RoolObject[] = [];
    for (const location of locations) {
      const object = await this.getObject(location);
      if (!object) continue;
      if (options.where && !this.objectMatchesWhere(object, options.where)) continue;
      objects.push(object);
      if (options.limit !== undefined && objects.length >= options.limit) break;
    }

    return { objects, message: `Found ${objects.length} ${objects.length === 1 ? 'object' : 'objects'}.` };
  }

  private objectMatchesWhere(object: RoolObject, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (!sameJsonValue(object.body[key], value)) return false;
    }
    return true;
  }

  /**
   * Get all object locations (sync, from local cache).
   * The list is loaded on open and kept current via SSE events.
   */
  getObjectLocations(options?: { limit?: number; order?: 'asc' | 'desc' }): string[] {
    let locs = this._objectLocations;
    if (options?.order === 'asc') {
      locs = [...locs].reverse();
    }
    if (options?.limit !== undefined) {
      locs = locs.slice(0, options.limit);
    }
    return locs;
  }

  /**
   * Create a new object in the given collection.
   *
   * @param collection - The collection (must exist in the schema)
   * @param body - Object body fields. Fields prefixed with `_` are hidden from AI.
   * @param options.basename - Specific basename to use. If omitted, the SDK generates a random one.
   * @returns The created object and a status message.
   */
  async createObject(
    collection: string,
    body: Record<string, unknown>,
    options?: CreateObjectOptions,
  ): Promise<{ object: RoolObject; message: string }> {
    return this._createObjectImpl(collection, body, options, this._conversationId);
  }

  /** @internal */
  async _createObjectImpl(
    collection: string,
    body: Record<string, unknown>,
    options: CreateObjectOptions | undefined,
    conversationId: string,
  ): Promise<{ object: RoolObject; message: string }> {
    const basename = options?.basename ?? generateBasename();
    const location = loc(collection, basename);

    const optimistic: RoolObject = { location, collection, basename, body };
    this._pendingMutations.set(location, optimistic);
    this.emit('objectCreated', { location, object: optimistic, source: 'local_user' });

    try {
      const interactionId = generateEntityId();
      await this.webdav.put(objectDavPath(location), JSON.stringify(body), {
        contentType: 'application/json',
        ifNoneMatch: '*',
        headers: this.davHeaders(conversationId, interactionId),
      });
      const fresh = await this.getObject(location) ?? optimistic;
      return { object: fresh, message: `Created ${location}` };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to create object:', error);
      this._pendingMutations.delete(location);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /**
   * Update an existing object.
   *
   * @param location - The object's location (canonical or short form)
   * @param options.data - Fields to add or update. Pass `null` to delete a field.
   */
  async updateObject(
    location: string,
    options: UpdateObjectOptions,
  ): Promise<{ object: RoolObject; message: string }> {
    return this._updateObjectImpl(location, options, this._conversationId);
  }

  /** @internal */
  async _updateObjectImpl(
    location: string,
    options: UpdateObjectOptions,
    conversationId: string,
  ): Promise<{ object: RoolObject; message: string }> {
    const canonical = normalizeLocation(location);
    const data = options.data ?? {};
    const current = await this.readObject(canonical);
    if (!current) throw new Error(`Object ${canonical} not found`);
    const body = patchBody(current.object.body, data);
    const optimistic = objectFromBody(canonical, body);
    this._pendingMutations.set(canonical, optimistic);
    this.emit('objectUpdated', { location: canonical, object: optimistic, source: 'local_user' });

    try {
      const interactionId = generateEntityId();
      await this.webdav.put(objectDavPath(canonical), JSON.stringify(body), {
        contentType: 'application/json',
        ifMatch: current.etag ?? undefined,
        headers: this.davHeaders(conversationId, interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Updated ${canonical}` };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to update object:', error);
      this._pendingMutations.delete(canonical);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /**
   * Move (rename or relocate) an object to a new location.
   * Use this to rename, change collection, or atomically rewrite the body.
   *
   * @param from - Current location
   * @param to - New location
   * @param options.body - Replace the body atomically as part of the move.
   */
  async moveObject(
    from: string,
    to: string,
    options?: MoveObjectOptions,
  ): Promise<{ object: RoolObject; message: string }> {
    return this._moveObjectImpl(from, to, options, this._conversationId);
  }

  /** @internal */
  async _moveObjectImpl(
    from: string,
    to: string,
    options: MoveObjectOptions | undefined,
    conversationId: string,
  ): Promise<{ object: RoolObject; message: string }> {
    const fromLoc = normalizeLocation(from);
    const toLoc = normalizeLocation(to);

    // Optimistic event — emit move so listeners can update keys
    const { collection, basename } = parseLocation(toLoc);
    const optimistic: RoolObject = {
      location: toLoc,
      collection,
      basename,
      body: options?.body ?? {},
    };
    this._pendingMutations.set(toLoc, optimistic);
    this.emit('objectMoved', { from: fromLoc, to: toLoc, object: optimistic, source: 'local_user' });

    try {
      const interactionId = generateEntityId();
      await this.webdav.move(objectDavPath(fromLoc), objectDavPath(toLoc), {
        headers: this.davHeaders(conversationId, interactionId),
      });
      if (options?.body) {
        await this.webdav.put(objectDavPath(toLoc), JSON.stringify(options.body), {
          contentType: 'application/json',
          headers: this.davHeaders(conversationId, interactionId),
        });
      }
      const fresh = await this.getObject(toLoc) ?? optimistic;
      return { object: fresh, message: `Moved ${fromLoc} to ${toLoc}` };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to move object:', error);
      this._pendingMutations.delete(toLoc);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /**
   * Delete objects by location.
   * Other objects that reference deleted objects will retain stale ref values.
   */
  async deleteObjects(locations: string[]): Promise<void> {
    return this._deleteObjectsImpl(locations, this._conversationId);
  }

  /** @internal */
  async _deleteObjectsImpl(locations: string[], conversationId: string): Promise<void> {
    if (locations.length === 0) return;
    const canonical = locations.map(normalizeLocation);

    // Track for dedup and emit optimistic events
    for (const location of canonical) {
      this._pendingMutations.set(location, null);
      this.emit('objectDeleted', { location, source: 'local_user' });
    }

    try {
      const interactionId = generateEntityId();
      for (const location of canonical) {
        await this.webdav.delete(objectDavPath(location), {
          headers: this.davHeaders(conversationId, interactionId),
        });
      }
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to delete objects:', error);
      for (const location of canonical) {
        this._pendingMutations.delete(location);
      }
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /** Get the current schema for this space. */
  getSchema(): SpaceSchema {
    return this._schema;
  }

  /** Create a new collection schema. */
  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this._createCollectionImpl(name, fields, this._conversationId);
  }

  /** @internal */
  async _createCollectionImpl(name: string, fields: FieldDef[], conversationId: string): Promise<CollectionDef> {
    if (this._schema[name]) {
      throw new Error(`Collection "${name}" already exists`);
    }

    // Optimistic local update
    const optimisticDef: CollectionDef = { fields: fields.map(f => ({ name: f.name, type: f.type })) };
    this._schema[name] = optimisticDef;

    try {
      await this.webdav.mkcol(collectionDavPath(name), { headers: this.davHeaders(conversationId, generateEntityId()) });
      await this.webdav.put(schemaDavPath(name), JSON.stringify(optimisticDef), {
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
  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this._alterCollectionImpl(name, fields, this._conversationId);
  }

  /** @internal */
  async _alterCollectionImpl(name: string, fields: FieldDef[], conversationId: string): Promise<CollectionDef> {
    if (!this._schema[name]) {
      throw new Error(`Collection "${name}" not found`);
    }

    const previous = this._schema[name];
    this._schema[name] = { fields: fields.map(f => ({ name: f.name, type: f.type })) };

    try {
      const updated = this._schema[name];
      await this.webdav.put(schemaDavPath(name), JSON.stringify(updated), {
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
      await this.webdav.delete(collectionDavPath(name), { headers: this.davHeaders(conversationId, generateEntityId()) });
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
          const resource = 'kind' in attachment ? attachment : await this.uploadAttachment(attachment, conversationId);
          return `rool-machine:${resource.path.split('/').map(encodeURIComponent).join('/')}`;
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
        this.graphqlClient.stopInteraction(this._id, interactionId).catch(() => { });
      } else {
        onAbort = () => {
          this.graphqlClient.stopInteraction(this._id, interactionId).catch(() => { });
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
    const fetched = await Promise.all(result.modifiedObjectLocations.map((location) => this.getObject(location)));
    for (const object of fetched) {
      if (object) objects.push(object);
    }

    return {
      message: result.message,
      objects,
    };
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
  ): Promise<MachineResource> {
    await this.ensureCollection('attachments');
    const directory = `attachments/${conversationId}`;
    await this.ensureCollection(directory);

    const attachment = attachmentBody(file);
    const path = `${directory}/${attachment.filename}`;
    await this.webdav.put(path, attachment.body, { contentType: attachment.contentType });
    const resource = resolveMachineResource(`/rool-drive/${path}`);
    if (!resource) throw new Error('Failed to resolve uploaded attachment');
    return resource;
  }

  private async ensureCollection(path: string): Promise<void> {
    // Note: not an object collection, a folder, which is "collection" in webdav land
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

    const changeSource: ChangeSource = event.source === 'agent' ? 'remote_agent' : 'remote_user';

    switch (event.type) {
      case 'connected':
        // Resync is handled by the client via _applyResyncData.
        break;

      case 'object_created':
        if (event.location && event.object) {
          if (event.objectStat) this._objectStats.set(event.location, event.objectStat);
          this._handleObjectCreated(event.location, event.object, changeSource);
        }
        break;

      case 'object_updated':
        if (event.location && event.object) {
          if (event.objectStat) this._objectStats.set(event.location, event.objectStat);
          this._handleObjectUpdated(event.location, event.object, changeSource);
        }
        break;

      case 'object_deleted':
        if (event.location) {
          this._objectStats.delete(event.location);
          this._handleObjectDeleted(event.location, changeSource);
        }
        break;

      case 'object_moved':
        if (event.from && event.to && event.object) {
          this._objectStats.delete(event.from);
          if (event.objectStat) this._objectStats.set(event.to, event.objectStat);
          this._handleObjectMoved(event.from, event.to, event.object, changeSource);
        }
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

  /** @internal */
  private _handleObjectCreated(location: string, object: RoolObject, source: ChangeSource): void {
    // Maintain local location list — prepend (most recently modified first)
    this._objectLocations = [location, ...this._objectLocations.filter(l => l !== location)];

    const pending = this._pendingMutations.get(location);
    if (pending !== undefined) {
      this._pendingMutations.delete(location);

      if (pending !== null) {
        // Already emitted objectCreated optimistically.
        // Emit objectUpdated only if AI resolved placeholders (data changed).
        if (JSON.stringify(pending) !== JSON.stringify(object)) {
          this.emit('objectUpdated', { location, object, source });
        }
      }
    } else {
      this.emit('objectCreated', { location, object, source });
    }
  }

  /** @internal */
  private _handleObjectUpdated(location: string, object: RoolObject, source: ChangeSource): void {
    this._objectLocations = [location, ...this._objectLocations.filter(l => l !== location)];

    const pending = this._pendingMutations.get(location);
    if (pending !== undefined) {
      this._pendingMutations.delete(location);

      if (pending !== null) {
        if (JSON.stringify(pending) !== JSON.stringify(object)) {
          this.emit('objectUpdated', { location, object, source });
        }
      }
    } else {
      this.emit('objectUpdated', { location, object, source });
    }
  }

  /** @internal */
  private _handleObjectDeleted(location: string, source: ChangeSource): void {
    this._objectLocations = this._objectLocations.filter(l => l !== location);

    const pending = this._pendingMutations.get(location);
    if (pending !== undefined) {
      this._pendingMutations.delete(location);
    } else {
      this.emit('objectDeleted', { location, source });
    }
  }

  /** @internal */
  private _handleObjectMoved(from: string, to: string, object: RoolObject, source: ChangeSource): void {
    // Drop old location, insert new one at the front.
    this._objectLocations = [to, ...this._objectLocations.filter(l => l !== from && l !== to)];

    const pending = this._pendingMutations.get(to);
    if (pending !== undefined) {
      this._pendingMutations.delete(to);
      if (pending !== null) {
        if (JSON.stringify(pending) !== JSON.stringify(object)) {
          this.emit('objectUpdated', { location: to, object, source });
        }
      }
    } else {
      this.emit('objectMoved', { from, to, object, source });
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

  /** Find objects using structured filters and/or natural language. */
  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this._channel._findObjectsImpl(options, this._conversationId);
  }

  /** Create a new object. */
  async createObject(
    collection: string,
    body: Record<string, unknown>,
    options?: CreateObjectOptions,
  ): Promise<{ object: RoolObject; message: string }> {
    return this._channel._createObjectImpl(collection, body, options, this._conversationId);
  }

  /** Update an existing object. */
  async updateObject(location: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._channel._updateObjectImpl(location, options, this._conversationId);
  }

  /** Move (rename/relocate) an object. */
  async moveObject(from: string, to: string, options?: MoveObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._channel._moveObjectImpl(from, to, options, this._conversationId);
  }

  /** Delete objects by location. */
  async deleteObjects(locations: string[]): Promise<void> {
    return this._channel._deleteObjectsImpl(locations, this._conversationId);
  }

  /** Send a prompt to the AI agent, scoped to this conversation's history. */
  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._channel._promptImpl(text, options, this._conversationId);
  }

  /** Create a new collection schema. */
  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this._channel._createCollectionImpl(name, fields, this._conversationId);
  }

  /** Alter an existing collection schema. */
  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this._channel._alterCollectionImpl(name, fields, this._conversationId);
  }

  /** Drop a collection schema. */
  async dropCollection(name: string): Promise<void> {
    return this._channel._dropCollectionImpl(name, this._conversationId);
  }

  setMetadata(key: string, value: unknown): void {
    return this._channel._setMetadataImpl(key, value, this._conversationId);
  }
}
