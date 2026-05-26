import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient } from './graphql.js';
import type { RestClient } from './rest.js';
import type { RoolWebDAV } from './webdav.js';
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

interface AttachmentUpload {
  filename: string;
  contentType: string;
  body: BodyInit;
}

function attachmentBody(
  file: File | Blob | { data: string; contentType: string }
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
    filename: safeAttachmentFilename('attachment', file.contentType),
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

// Default timeout for waiting on SSE object events (30 seconds)
const OBJECT_COLLECT_TIMEOUT = 30000;

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
  // Resolvers waiting for object data from SSE events, keyed by location
  private _objectResolvers = new Map<string, (obj: RoolObject) => void>();
  // Buffer for object data that arrived before a collector was registered, keyed by location
  private _objectBuffer = new Map<string, RoolObject>();

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

    // Clean up pending object collectors
    this._objectResolvers.clear();
    this._objectBuffer.clear();
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

  /**
   * Get an object by location. Fetches from the server on each call.
   *
   * Accepts either the canonical form (`/space/<collection>/<basename>.json`)
   * or the short form (`<collection>/<basename>`).
   */
  async getObject(location: string): Promise<RoolObject | undefined> {
    return this.graphqlClient.getObject(this._id, normalizeLocation(location));
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
  _findObjectsImpl(options: FindObjectsOptions, conversationId: string): Promise<{ objects: RoolObject[]; message: string }> {
    const normalized: FindObjectsOptions = {
      ...options,
      locations: options.locations?.map(normalizeLocation),
    };
    return this.graphqlClient.findObjects(this._id, normalized, this._channelId, conversationId);
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
   * @param body - Object body fields. Use `{{placeholder}}` for AI-generated content.
   *               Fields prefixed with `_` are hidden from AI.
   * @param options.basename - Specific basename to use. If omitted, the SDK generates a random one.
   * @param options.ephemeral - If true, the operation won't be recorded in interaction history.
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
      const { message, object } = await this.graphqlClient.createObject(
        this._id,
        location,
        body,
        this._channelId,
        conversationId,
        interactionId,
        { ephemeral: options?.ephemeral, parentInteractionId: options?.parentInteractionId },
      );
      const fresh = object ?? await this._collectObject(location);
      return { object: fresh, message };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to create object:', error);
      this._pendingMutations.delete(location);
      this._cancelCollector(location);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /**
   * Update an existing object.
   *
   * @param location - The object's location (canonical or short form)
   * @param options.data - Fields to add or update. Pass `null` to delete a field. Use `{{placeholder}}` for AI-generated content.
   * @param options.prompt - AI prompt to drive the update.
   * @param options.ephemeral - If true, the operation won't be recorded in interaction history.
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
    const { data } = options;

    // Normalize undefined to null (for JSON serialization) and build server patch
    let serverPatch: Record<string, unknown> | undefined;
    if (data) {
      serverPatch = {};
      for (const [key, value] of Object.entries(data)) {
        serverPatch[key] = value === undefined ? null : value;
      }
    }

    // Emit optimistic event if we have data changes
    if (data) {
      const { collection, basename } = parseLocation(canonical);
      const optimistic: RoolObject = { location: canonical, collection, basename, body: data };
      this._pendingMutations.set(canonical, optimistic);
      this.emit('objectUpdated', { location: canonical, object: optimistic, source: 'local_user' });
    }

    try {
      const interactionId = generateEntityId();
      const { message, object } = await this.graphqlClient.updateObject(
        this._id,
        canonical,
        this._channelId,
        conversationId,
        interactionId,
        {
          patch: serverPatch,
          prompt: options.prompt,
          ephemeral: options.ephemeral,
          parentInteractionId: options.parentInteractionId,
        },
      );
      const fresh = object ?? await this._collectObject(canonical);
      return { object: fresh, message };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to update object:', error);
      this._pendingMutations.delete(canonical);
      this._cancelCollector(canonical);
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
   * @param options.ephemeral - If true, the operation won't be recorded in interaction history.
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
      const { message, object } = await this.graphqlClient.moveObject(
        this._id,
        fromLoc,
        toLoc,
        this._channelId,
        conversationId,
        interactionId,
        {
          body: options?.body,
          ephemeral: options?.ephemeral,
          parentInteractionId: options?.parentInteractionId,
        },
      );
      const fresh = object ?? await this._collectObject(toLoc);
      return { object: fresh, message };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to move object:', error);
      this._pendingMutations.delete(toLoc);
      this._cancelCollector(toLoc);
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
      await this.graphqlClient.deleteObjects(this._id, canonical, this._channelId, conversationId, interactionId);
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
      return await this.graphqlClient.createCollection(this._id, name, fields, this._channelId, conversationId);
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
      return await this.graphqlClient.alterCollection(this._id, name, fields, this._channelId, conversationId);
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
      await this.graphqlClient.dropCollection(this._id, name, this._channelId, conversationId);
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
    const { attachments, parentInteractionId: explicitParent, signal, locations, ...rest } = options ?? {};
    const interactionId = generateEntityId();

    let attachmentRefs: string[] | undefined;
    if (attachments?.length) {
      const resources = await Promise.all(
        attachments.map((file) => this.uploadAttachment(file, conversationId))
      );
      attachmentRefs = resources.map((resource) => `rool-machine:${resource.path.split('/').map(encodeURIComponent).join('/')}`);
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
        locations: locations?.map(normalizeLocation),
        attachmentRefs,
        interactionId,
        parentInteractionId,
      });
    } finally {
      if (onAbort) signal!.removeEventListener('abort', onAbort);
    }

    // Collect modified objects — they arrive via SSE events during/after the mutation.
    const objects: RoolObject[] = [];
    const missing: string[] = [];

    for (const location of result.modifiedObjectLocations) {
      const buffered = this._objectBuffer.get(location);
      if (buffered) {
        this._objectBuffer.delete(location);
        objects.push(buffered);
      } else {
        missing.push(location);
      }
    }

    if (missing.length > 0) {
      const fetched = await Promise.all(
        missing.map(location => this.graphqlClient.getObject(this._id, location))
      );
      for (const obj of fetched) {
        if (obj) objects.push(obj);
      }
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
    file: File | Blob | { data: string; contentType: string },
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
   * Register a collector that resolves when the object arrives via SSE.
   * @internal
   */
  private _collectObject(location: string): Promise<RoolObject> {
    return new Promise<RoolObject>((resolve, reject) => {
      const buffered = this._objectBuffer.get(location);
      if (buffered) {
        this._objectBuffer.delete(location);
        resolve(buffered);
        return;
      }

      const timer = setTimeout(() => {
        this._objectResolvers.delete(location);
        // Fallback: try to fetch from server
        this.graphqlClient.getObject(this._id, location).then(obj => {
          if (obj) {
            resolve(obj);
          } else {
            reject(new Error(`Timeout waiting for object ${location} from SSE`));
          }
        }).catch(reject);
      }, OBJECT_COLLECT_TIMEOUT);

      this._objectResolvers.set(location, (obj) => {
        clearTimeout(timer);
        resolve(obj);
      });
    });
  }

  /** @internal */
  private _cancelCollector(location: string): void {
    this._objectResolvers.delete(location);
    this._objectBuffer.delete(location);
  }

  /** @internal */
  private _deliverObject(location: string, object: RoolObject): void {
    const resolver = this._objectResolvers.get(location);
    if (resolver) {
      resolver(object);
      this._objectResolvers.delete(location);
    } else {
      this._objectBuffer.set(location, object);
    }
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
    this._deliverObject(location, object);

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
    this._deliverObject(location, object);

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
    this._deliverObject(to, object);

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
