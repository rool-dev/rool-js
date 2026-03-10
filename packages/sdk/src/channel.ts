import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient } from './graphql.js';
import type { MediaClient } from './media.js';
import type { AuthManager } from './auth.js';
import { SpaceSubscriptionManager } from './subscription.js';
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
  MediaInfo,
  MediaResponse,
  ChangeSource,
  SpaceEvent,
  Interaction,
  Conversation,
  LinkAccess,
  SpaceSchema,
  CollectionDef,
  FieldDef,
} from './types.js';

// 6-character alphanumeric ID (62^6 = 56.8 billion possible values)
const ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateEntityId(): string {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return result;
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
  /** Object IDs in the space (sorted by modifiedAt desc) */
  objectIds: string[];
  /** Object stats keyed by object ID */
  objectStats: Record<string, RoolObjectStat>;
  /** Collection schema */
  schema: SpaceSchema;
  /** Space metadata */
  meta: Record<string, unknown>;
  /** This channel's conversation (undefined if new) */
  conversation: Conversation | undefined;
  /** Conversation ID for this channel (required). */
  conversationId: string;
  graphqlClient: GraphQLClient;
  mediaClient: MediaClient;
  graphqlUrl: string;
  authManager: AuthManager;
  logger: Logger;
  onClose: (spaceId: string) => void;
}

/**
 * A channel is a space + conversationId pair.
 *
 * All object operations go through a channel. The conversationId is fixed
 * at open time and cannot be changed. To use a different conversation,
 * open a second channel.
 *
 * Objects are fetched on demand from the server; only schema, metadata,
 * and the channel's own conversation are cached locally. Object changes
 * arrive via SSE semantic events and are emitted as SDK events.
 *
 * Features:
 * - High-level object operations
 * - Built-in undo/redo with checkpoints
 * - Metadata management
 * - Event emission for state changes
 * - Real-time updates via space-specific subscription
 */
export class RoolChannel extends EventEmitter<ChannelEvents> {
  private _id: string;
  private _name: string;
  private _role: RoolUserRole;
  private _linkAccess: LinkAccess;
  private _userId: string;
  private _conversationId: string;
  private _closed: boolean = false;
  private graphqlClient: GraphQLClient;
  private mediaClient: MediaClient;
  private subscriptionManager: SpaceSubscriptionManager;
  private onCloseCallback: (spaceId: string) => void;
  private _subscriptionReady: Promise<void>;
  private logger: Logger;

  // Local cache for bounded data (schema, metadata, own conversation, object IDs, stats)
  private _meta: Record<string, unknown>;
  private _schema: SpaceSchema;
  private _conversation: Conversation | undefined;
  private _objectIds: string[];
  private _objectStats: Map<string, RoolObjectStat>;

  // Object collection: tracks pending local mutations for dedup
  // Maps objectId → optimistic object data (for create/update) or null (for delete)
  private _pendingMutations = new Map<string, RoolObject | null>();
  // Resolvers waiting for object data from SSE events
  private _objectResolvers = new Map<string, (obj: RoolObject) => void>();
  // Buffer for object data that arrived before a collector was registered
  private _objectBuffer = new Map<string, RoolObject>();

  constructor(config: ChannelConfig) {
    super();
    this._id = config.id;
    this._name = config.name;
    this._role = config.role;
    this._linkAccess = config.linkAccess;
    this._userId = config.userId;
    this._emitterLogger = config.logger;
    this._conversationId = config.conversationId;
    this.graphqlClient = config.graphqlClient;
    this.mediaClient = config.mediaClient;
    this.logger = config.logger;
    this.onCloseCallback = config.onClose;

    // Initialize local cache from server data
    this._meta = config.meta;
    this._schema = config.schema;
    this._conversation = config.conversation;
    this._objectIds = config.objectIds;
    this._objectStats = new Map(Object.entries(config.objectStats));

    // Create space-level subscription
    this.subscriptionManager = new SpaceSubscriptionManager({
      graphqlUrl: config.graphqlUrl,
      authManager: config.authManager,
      logger: this.logger,
      spaceId: this._id,
      conversationId: this._conversationId,
      onEvent: (event) => this.handleSpaceEvent(event),
      onConnectionStateChanged: () => {
        // Space-level connection state (could emit events if needed)
      },
      onError: (error) => {
        this.logger.error(`[RoolChannel ${this._id}] Subscription error:`, error);
      },
    });

    // Start subscription - store promise for openChannel to await
    this._subscriptionReady = this.subscriptionManager.subscribe();
  }

  /**
   * Wait for the real-time subscription to be established.
   * Called internally by openChannel/createSpace before returning the channel.
   * @internal
   */
  _waitForSubscription(): Promise<void> {
    return this._subscriptionReady;
  }

  // ===========================================================================
  // Properties
  // ===========================================================================

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
   * Get the conversation ID for this channel.
   * Fixed at open time — cannot be changed.
   */
  get conversationId(): string {
    return this._conversationId;
  }

  get isReadOnly(): boolean {
    return this._role === 'viewer';
  }

  // ===========================================================================
  // Conversation Access
  // ===========================================================================

  /**
   * Get interactions for this channel's conversation.
   */
  getInteractions(): Interaction[] {
    return this._conversation?.interactions ?? [];
  }

  // ===========================================================================
  // Channel Lifecycle
  // ===========================================================================

  /**
   * Close this channel and clean up resources.
   * Stops real-time subscription and unregisters from client.
   */
  close(): void {
    this._closed = true;
    this.subscriptionManager.destroy();
    this.onCloseCallback(this._id);

    // Clean up pending object collectors
    this._objectResolvers.clear();
    this._objectBuffer.clear();
    this._pendingMutations.clear();

    this.removeAllListeners();
  }

  // ===========================================================================
  // Undo / Redo (Server-managed checkpoints)
  // ===========================================================================

  /**
   * Create a checkpoint (seal current batch of changes).
   * @returns The checkpoint ID
   */
  async checkpoint(label: string = 'Change'): Promise<string> {
    const result = await this.graphqlClient.checkpoint(
      this._id,
      label,
      this._conversationId,
    );
    return result.checkpointId;
  }

  /**
   * Check if undo is available.
   */
  async canUndo(): Promise<boolean> {
    const status = await this.graphqlClient.checkpointStatus(this._id, this._conversationId);
    return status.canUndo;
  }

  /**
   * Check if redo is available.
   */
  async canRedo(): Promise<boolean> {
    const status = await this.graphqlClient.checkpointStatus(this._id, this._conversationId);
    return status.canRedo;
  }

  /**
   * Undo the most recent batch of changes.
   * Reverses your most recent batch (sealed or open).
   * Conflicting patches (modified by others) are silently skipped.
   * @returns true if undo was performed
   */
  async undo(): Promise<boolean> {
    const result = await this.graphqlClient.undo(this._id, this._conversationId);
    // Server broadcasts space_changed, which triggers reset event
    return result.success;
  }

  /**
   * Redo a previously undone batch of changes.
   * @returns true if redo was performed
   */
  async redo(): Promise<boolean> {
    const result = await this.graphqlClient.redo(this._id, this._conversationId);
    // Server broadcasts space_changed, which triggers reset event
    return result.success;
  }

  /**
   * Clear checkpoint history for this conversation.
   */
  async clearHistory(): Promise<void> {
    await this.graphqlClient.clearCheckpointHistory(this._id, this._conversationId);
  }

  // ===========================================================================
  // Object Operations
  // ===========================================================================

  /**
   * Get an object's data by ID.
   * Fetches from the server on each call.
   */
  async getObject(objectId: string): Promise<RoolObject | undefined> {
    return this.graphqlClient.getObject(this._id, objectId);
  }

  /**
   * Get an object's stat (audit information).
   * Returns modification timestamp and author, or undefined if object not found.
   */
  stat(objectId: string): RoolObjectStat | undefined {
    return this._objectStats.get(objectId);
  }

  /**
   * Find objects using structured filters and/or natural language.
   *
   * `where` provides exact-match filtering — values must match literally (no placeholders or operators).
   * `prompt` enables AI-powered semantic queries. When both are provided, `where` and `objectIds`
   * constrain the data set before the AI sees it.
   *
   * @param options.where - Exact-match field filter (e.g. `{ type: 'article' }`). Constrains which objects the AI can see when combined with `prompt`.
   * @param options.prompt - Natural language query. Triggers AI evaluation (uses credits).
   * @param options.limit - Maximum number of results to return (applies to structured filtering only; the AI controls its own result size).
   * @param options.objectIds - Scope search to specific object IDs. Constrains the candidate set in both structured and AI queries.
   * @param options.order - Sort order by modifiedAt: `'asc'` or `'desc'` (default: `'desc'`). Only applies to structured filtering (no `prompt`).
   * @param options.ephemeral - If true, the query won't be recorded in conversation history.
   * @returns The matching objects and a descriptive message.
   */
  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this.graphqlClient.findObjects(this._id, options, this._conversationId);
  }

  /**
   * Get all object IDs (sync, from local cache).
   * The list is loaded on open and kept current via SSE events.
   * @param options.limit - Maximum number of IDs to return
   * @param options.order - Sort order by modifiedAt ('asc' or 'desc', default: 'desc')
   */
  getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }): string[] {
    let ids = this._objectIds;
    if (options?.order === 'asc') {
      ids = [...ids].reverse();
    }
    if (options?.limit !== undefined) {
      ids = ids.slice(0, options.limit);
    }
    return ids;
  }

  /**
   * Create a new object with optional AI generation.
   * @param options.data - Object data fields (any key-value pairs). Optionally include `id` to use a custom ID. Use {{placeholder}} for AI-generated content. Fields prefixed with _ are hidden from AI.
   * @param options.ephemeral - If true, the operation won't be recorded in conversation history.
   * @returns The created object (with AI-filled content) and message
   */
  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    const { data, ephemeral } = options;

    // Use data.id if provided (string), otherwise generate
    const objectId = typeof data.id === 'string' ? data.id : generateEntityId();

    // Validate ID format: alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(objectId)) {
      throw new Error(`Invalid object ID "${objectId}". IDs must contain only alphanumeric characters, hyphens, and underscores.`);
    }

    const dataWithId = { ...data, id: objectId } as RoolObject;

    // Emit optimistic event and track for dedup
    this._pendingMutations.set(objectId, dataWithId);
    this.emit('objectCreated', { objectId, object: dataWithId, source: 'local_user' });

    try {
      // Await mutation — server processes AI placeholders before responding.
      // SSE events arrive during the await and are buffered via _deliverObject.
      const { message } = await this.graphqlClient.createObject(this.id, dataWithId, this._conversationId, ephemeral);
      // Collect resolved object from buffer (or wait if not yet arrived)
      const object = await this._collectObject(objectId);
      return { object, message };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to create object:', error);
      this._pendingMutations.delete(objectId);
      this._cancelCollector(objectId);
      // Emit reset so UI can recover from the optimistic event
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /**
   * Update an existing object.
   * @param objectId - The ID of the object to update
   * @param options.data - Fields to add or update. Pass null or undefined to delete a field. Use {{placeholder}} for AI-generated content. Fields prefixed with _ are hidden from AI.
   * @param options.prompt - AI prompt for content editing (optional).
   * @param options.ephemeral - If true, the operation won't be recorded in conversation history.
   * @returns The updated object (with AI-filled content) and message
   */
  async updateObject(
    objectId: string,
    options: UpdateObjectOptions
  ): Promise<{ object: RoolObject; message: string }> {
    const { data, ephemeral } = options;

    // id is immutable after creation (but null/undefined means delete attempt, which we also reject)
    if (data?.id !== undefined && data.id !== null) {
      throw new Error('Cannot change id in updateObject. The id field is immutable after creation.');
    }
    if (data && ('id' in data)) {
      throw new Error('Cannot delete id field. The id field is immutable after creation.');
    }

    // Normalize undefined to null (for JSON serialization) and build server data
    let serverData: Record<string, unknown> | undefined;
    if (data) {
      serverData = {};
      for (const [key, value] of Object.entries(data)) {
        // Convert undefined to null for wire protocol
        serverData[key] = value === undefined ? null : value;
      }
    }

    // Emit optimistic event if we have data changes
    if (data) {
      // Build optimistic object (best effort — we may not have the current state)
      const optimistic = { id: objectId, ...data } as RoolObject;
      this._pendingMutations.set(objectId, optimistic);
      this.emit('objectUpdated', { objectId, object: optimistic, source: 'local_user' });
    }

    try {
      const { message } = await this.graphqlClient.updateObject(this.id, objectId, this._conversationId, serverData, options.prompt, ephemeral);
      const object = await this._collectObject(objectId);
      return { object, message };
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to update object:', error);
      this._pendingMutations.delete(objectId);
      this._cancelCollector(objectId);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  /**
   * Delete objects by IDs.
   * Other objects that reference deleted objects via data fields will retain stale ref values.
   */
  async deleteObjects(objectIds: string[]): Promise<void> {
    if (objectIds.length === 0) return;

    // Track for dedup and emit optimistic events
    for (const objectId of objectIds) {
      this._pendingMutations.set(objectId, null);
      this.emit('objectDeleted', { objectId, source: 'local_user' });
    }

    try {
      await this.graphqlClient.deleteObjects(this.id, objectIds, this._conversationId);
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to delete objects:', error);
      for (const objectId of objectIds) {
        this._pendingMutations.delete(objectId);
      }
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      this.emit('reset', { source: 'system' });
      throw error;
    }
  }

  // ===========================================================================
  // Collection Schema Operations
  // ===========================================================================

  /**
   * Get the current schema for this space.
   * Returns a map of collection names to their definitions.
   */
  getSchema(): SpaceSchema {
    return this._schema;
  }

  /**
   * Create a new collection schema.
   * @param name - Collection name (must start with a letter, alphanumeric/hyphens/underscores only)
   * @param fields - Field definitions for the collection
   * @returns The created CollectionDef
   */
  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    if (this._schema[name]) {
      throw new Error(`Collection "${name}" already exists`);
    }

    // Optimistic local update
    const optimisticDef: CollectionDef = { fields: fields.map(f => ({ name: f.name, type: f.type })) };
    this._schema[name] = optimisticDef;

    try {
      return await this.graphqlClient.createCollection(this._id, name, fields, this._conversationId);
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to create collection:', error);
      delete this._schema[name];
      throw error;
    }
  }

  /**
   * Alter an existing collection schema, replacing its field definitions.
   * @param name - Name of the collection to alter
   * @param fields - New field definitions (replaces all existing fields)
   * @returns The updated CollectionDef
   */
  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    if (!this._schema[name]) {
      throw new Error(`Collection "${name}" not found`);
    }

    const previous = this._schema[name];
    // Optimistic local update
    this._schema[name] = { fields: fields.map(f => ({ name: f.name, type: f.type })) };

    try {
      return await this.graphqlClient.alterCollection(this._id, name, fields, this._conversationId);
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to alter collection:', error);
      this._schema[name] = previous;
      throw error;
    }
  }

  /**
   * Drop a collection schema.
   * @param name - Name of the collection to drop
   */
  async dropCollection(name: string): Promise<void> {
    if (!this._schema[name]) {
      throw new Error(`Collection "${name}" not found`);
    }

    const previous = this._schema[name];
    // Optimistic local update
    delete this._schema[name];

    try {
      await this.graphqlClient.dropCollection(this._id, name, this._conversationId);
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to drop collection:', error);
      this._schema[name] = previous;
      throw error;
    }
  }

  // ===========================================================================
  // System Instructions
  // ===========================================================================

  /**
   * Get the system instruction for this channel's conversation.
   * Returns undefined if no system instruction is set.
   */
  getSystemInstruction(): string | undefined {
    return this._conversation?.systemInstruction;
  }

  /**
   * Set the system instruction for this channel's conversation.
   * Pass null to clear the instruction.
   */
  async setSystemInstruction(instruction: string | null): Promise<void> {
    // Optimistic local update
    if (!this._conversation) {
      this._conversation = {
        createdAt: Date.now(),
        createdBy: this._userId,
        interactions: [],
      };
    }
    const previous = this._conversation;
    if (instruction === null) {
      const { systemInstruction: _, ...rest } = this._conversation;
      this._conversation = rest;
    } else {
      this._conversation = { ...this._conversation, systemInstruction: instruction };
    }

    // Emit event
    this.emit('conversationUpdated', {
      conversationId: this._conversationId,
      source: 'local_user',
    });

    // Call server
    try {
      await this.graphqlClient.setSystemInstruction(this.id, this._conversationId, instruction);
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to set system instruction:', error);
      this._conversation = previous;
      throw error;
    }
  }

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  /**
   * Set a space-level metadata value.
   * Metadata is stored in meta and hidden from AI operations.
   */
  setMetadata(key: string, value: unknown): void {
    this._meta[key] = value;
    this.emit('metadataUpdated', { metadata: this._meta, source: 'local_user' });

    // Fire-and-forget server call
    this.graphqlClient.setSpaceMeta(this.id, this._meta, this._conversationId)
      .catch((error) => {
        this.logger.error('[RoolChannel] Failed to set meta:', error);
      });
  }

  /**
   * Get a space-level metadata value.
   */
  getMetadata(key: string): unknown {
    return this._meta[key];
  }

  /**
   * Get all space-level metadata.
   */
  getAllMetadata(): Record<string, unknown> {
    return this._meta;
  }

  // ===========================================================================
  // AI Operations
  // ===========================================================================

  /**
   * Send a prompt to the AI agent for space manipulation.
   * @returns The message from the AI and the list of objects that were created or modified
   */
  async prompt(prompt: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    // Upload attachments via media endpoint, then send URLs to the server
    const { attachments, ...rest } = options ?? {};
    let attachmentUrls: string[] | undefined;
    if (attachments?.length) {
      attachmentUrls = await Promise.all(
        attachments.map(file => this.mediaClient.upload(this._id, file))
      );
    }

    const result = await this.graphqlClient.prompt(this._id, prompt, this._conversationId, { ...rest, attachmentUrls });

    // Collect modified objects — they arrive via SSE events during/after the mutation.
    // Try collecting from buffer first, then fetch any missing from server.
    const objects: RoolObject[] = [];
    const missing: string[] = [];

    for (const id of result.modifiedObjectIds) {
      const buffered = this._objectBuffer.get(id);
      if (buffered) {
        this._objectBuffer.delete(id);
        objects.push(buffered);
      } else {
        missing.push(id);
      }
    }

    // Fetch any objects not yet received via SSE
    if (missing.length > 0) {
      const fetched = await Promise.all(
        missing.map(id => this.graphqlClient.getObject(this._id, id))
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

  // ===========================================================================
  // Channel Admin
  // ===========================================================================

  /**
   * Rename this channel (conversation).
   */
  async rename(newName: string): Promise<void> {
    await this.graphqlClient.renameConversation(this._id, this._conversationId, newName);
  }

  // ===========================================================================
  // Media Operations
  // ===========================================================================

  /**
   * List all media files for this space.
   */
  async listMedia(): Promise<MediaInfo[]> {
    return this.mediaClient.list(this._id);
  }

  /**
   * Upload a file to this space. Returns the URL.
   */
  async uploadMedia(
    file: File | Blob | { data: string; contentType: string }
  ): Promise<string> {
    return this.mediaClient.upload(this._id, file);
  }

  /**
   * Fetch any URL, returning headers and a blob() method (like fetch Response).
   * Adds auth headers for backend media URLs, fetches external URLs via server proxy if CORS blocks.
   */
  async fetchMedia(url: string): Promise<MediaResponse> {
    return this.mediaClient.fetch(this._id, url);
  }

  /**
   * Delete a media file by URL.
   */
  async deleteMedia(url: string): Promise<void> {
    return this.mediaClient.delete(this._id, url);
  }

  // ===========================================================================
  // Object Collection (internal)
  // ===========================================================================

  /**
   * Register a collector that resolves when the object arrives via SSE.
   * If the object is already in the buffer (arrived before collector), resolves immediately.
   * @internal
   */
  private _collectObject(objectId: string): Promise<RoolObject> {
    return new Promise<RoolObject>((resolve, reject) => {
      // Check buffer first — SSE event may have arrived before the HTTP response
      const buffered = this._objectBuffer.get(objectId);
      if (buffered) {
        this._objectBuffer.delete(objectId);
        resolve(buffered);
        return;
      }

      const timer = setTimeout(() => {
        this._objectResolvers.delete(objectId);
        // Fallback: try to fetch from server
        this.graphqlClient.getObject(this._id, objectId).then(obj => {
          if (obj) {
            resolve(obj);
          } else {
            reject(new Error(`Timeout waiting for object ${objectId} from SSE`));
          }
        }).catch(reject);
      }, OBJECT_COLLECT_TIMEOUT);

      this._objectResolvers.set(objectId, (obj) => {
        clearTimeout(timer);
        resolve(obj);
      });
    });
  }

  /**
   * Cancel a pending object collector (e.g., on mutation error).
   * @internal
   */
  private _cancelCollector(objectId: string): void {
    this._objectResolvers.delete(objectId);
    this._objectBuffer.delete(objectId);
  }

  /**
   * Deliver an object to a pending collector, or buffer it for later collection.
   * @internal
   */
  private _deliverObject(objectId: string, object: RoolObject): void {
    const resolver = this._objectResolvers.get(objectId);
    if (resolver) {
      resolver(object);
      this._objectResolvers.delete(objectId);
    } else {
      // Buffer for prompt() or late collectors
      this._objectBuffer.set(objectId, object);
    }
  }

  // ===========================================================================
  // Event Handlers (internal - handles space subscription events)
  // ===========================================================================

  /**
   * Handle a space event from the subscription.
   * @internal
   */
  private handleSpaceEvent(event: SpaceEvent): void {
    // Ignore events after close - the channel is being torn down
    if (this._closed) return;

    const changeSource: ChangeSource = event.source === 'agent' ? 'remote_agent' : 'remote_user';

    switch (event.type) {
      case 'object_created':
        if (event.objectId && event.object) {
          if (event.objectStat) this._objectStats.set(event.objectId, event.objectStat);
          this._handleObjectCreated(event.objectId, event.object, changeSource);
        }
        break;

      case 'object_updated':
        if (event.objectId && event.object) {
          if (event.objectStat) this._objectStats.set(event.objectId, event.objectStat);
          this._handleObjectUpdated(event.objectId, event.object, changeSource);
        }
        break;

      case 'object_deleted':
        if (event.objectId) {
          this._objectStats.delete(event.objectId);
          this._handleObjectDeleted(event.objectId, changeSource);
        }
        break;

      case 'schema_updated':
        if (event.schema) {
          this._schema = event.schema;
        }
        break;

      case 'metadata_updated':
        if (event.metadata) {
          this._meta = event.metadata;
          this.emit('metadataUpdated', { metadata: this._meta, source: changeSource });
        }
        break;

      case 'conversation_updated':
        // Only update if it's our conversation
        if (event.conversationId === this._conversationId && event.conversation) {
          this._conversation = event.conversation;
          this.emit('conversationUpdated', { conversationId: event.conversationId, source: changeSource });
        }
        break;

      case 'space_changed':
        // Full reload needed (undo/redo, bulk operations)
        void this.graphqlClient.openChannel(this._id, this._conversationId).then((result) => {
          if (this._closed) return;
          this._meta = result.meta;
          this._schema = result.schema;
          this._conversation = result.conversation;
          this._objectIds = result.objectIds;
          this._objectStats = new Map(Object.entries(result.objectStats));
          this.emit('reset', { source: changeSource });
        });
        break;
    }
  }

  /**
   * Handle an object_created SSE event.
   * Deduplicates against optimistic local creates.
   * @internal
   */
  private _handleObjectCreated(objectId: string, object: RoolObject, source: ChangeSource): void {
    // Deliver to any pending collector (for mutation return values)
    this._deliverObject(objectId, object);

    // Maintain local ID list — prepend (most recently modified first)
    this._objectIds = [objectId, ...this._objectIds.filter(id => id !== objectId)];

    const pending = this._pendingMutations.get(objectId);
    if (pending !== undefined) {
      // This is our own mutation echoed back
      this._pendingMutations.delete(objectId);

      if (pending !== null) {
        // It was a create — already emitted objectCreated optimistically.
        // Emit objectUpdated only if AI resolved placeholders (data changed).
        if (JSON.stringify(pending) !== JSON.stringify(object)) {
          this.emit('objectUpdated', { objectId, object, source });
        }
      }
    } else {
      // Remote event — emit normally
      this.emit('objectCreated', { objectId, object, source });
    }
  }

  /**
   * Handle an object_updated SSE event.
   * Deduplicates against optimistic local updates.
   * @internal
   */
  private _handleObjectUpdated(objectId: string, object: RoolObject, source: ChangeSource): void {
    // Deliver to any pending collector
    this._deliverObject(objectId, object);

    // Maintain local ID list — move to front (most recently modified)
    this._objectIds = [objectId, ...this._objectIds.filter(id => id !== objectId)];

    const pending = this._pendingMutations.get(objectId);
    if (pending !== undefined) {
      // This is our own mutation echoed back
      this._pendingMutations.delete(objectId);

      if (pending !== null) {
        // Already emitted objectUpdated optimistically.
        // Emit again only if data changed (AI resolved placeholders).
        if (JSON.stringify(pending) !== JSON.stringify(object)) {
          this.emit('objectUpdated', { objectId, object, source });
        }
      }
    } else {
      // Remote event
      this.emit('objectUpdated', { objectId, object, source });
    }
  }

  /**
   * Handle an object_deleted SSE event.
   * Deduplicates against optimistic local deletes.
   * @internal
   */
  private _handleObjectDeleted(objectId: string, source: ChangeSource): void {
    // Remove from local ID list
    this._objectIds = this._objectIds.filter(id => id !== objectId);

    const pending = this._pendingMutations.get(objectId);
    if (pending !== undefined) {
      // This is our own delete echoed back — already emitted
      this._pendingMutations.delete(objectId);
    } else {
      // Remote event
      this.emit('objectDeleted', { objectId, source });
    }
  }
}
