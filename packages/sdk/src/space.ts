import { immutableJSONPatch } from 'immutable-json-patch';
import { zipSync, unzipSync } from 'fflate';
import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient } from './graphql.js';
import type { MediaClient } from './media.js';
import type { AuthManager } from './auth.js';
import { SpaceSubscriptionManager } from './subscription.js';
import { toJsonLd, fromJsonLd, findAllStrings, rewriteStrings, type JsonLdDocument } from './jsonld.js';
import type {
  RoolSpaceData,
  RoolObject,
  RoolObjectEntry,
  RoolObjectStat,
  JSONPatchOp,
  SpaceEvents,
  RoolUserRole,
  SpaceMember,
  PromptOptions,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  MediaInfo,
  MediaResponse,
  ChangeSource,
  SpaceEvent,
  RoolEventSource,
  Interaction,
  ConversationInfo,
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

// Content type <-> file extension mapping for archive media files
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/json': '.json',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

function getExtensionFromContentType(contentType: string): string {
  // Strip parameters like charset
  const base = contentType.split(';')[0].trim();
  return MIME_TO_EXT[base] ?? '.bin';
}

function getContentTypeFromFilename(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export interface SpaceConfig {
  id: string;
  name: string;
  role: RoolUserRole;
  /** Current user's ID (for identifying own interactions) */
  userId: string;
  initialData: RoolSpaceData;
  /** Optional conversation ID for AI context continuity. If not provided, a new conversation is created. */
  conversationId?: string;
  graphqlClient: GraphQLClient;
  mediaClient: MediaClient;
  graphqlUrl: string;
  authManager: AuthManager;
  onClose: (spaceId: string) => void;
}

/**
 * First-class Space object.
 * 
 * Features:
 * - High-level object/link operations
 * - Built-in undo/redo with checkpoints
 * - Metadata management
 * - Event emission for state changes
 * - Real-time updates via space-specific subscription
 */
export class RoolSpace extends EventEmitter<SpaceEvents> {
  private _id: string;
  private _name: string;
  private _role: RoolUserRole;
  private _userId: string;
  private _conversationId: string;
  private _data: RoolSpaceData;
  private graphqlClient: GraphQLClient;
  private mediaClient: MediaClient;
  private subscriptionManager: SpaceSubscriptionManager;
  private onCloseCallback: (spaceId: string) => void;
  private _subscriptionReady: Promise<void>;

  constructor(config: SpaceConfig) {
    super();
    this._id = config.id;
    this._name = config.name;
    this._role = config.role;
    this._userId = config.userId;
    this._conversationId = config.conversationId ?? generateEntityId();
    this._data = config.initialData;
    this.graphqlClient = config.graphqlClient;
    this.mediaClient = config.mediaClient;
    this.onCloseCallback = config.onClose;

    // Create space-level subscription
    this.subscriptionManager = new SpaceSubscriptionManager({
      graphqlUrl: config.graphqlUrl,
      authManager: config.authManager,
      spaceId: this._id,
      conversationId: this._conversationId,
      onEvent: (event) => this.handleSpaceEvent(event),
      onConnectionStateChanged: () => {
        // Space-level connection state (could emit events if needed)
      },
      onError: (error) => {
        console.error(`[RoolSpace ${this._id}] Subscription error:`, error);
      },
    });

    // Start subscription - store promise for openSpace/createSpace to await
    this._subscriptionReady = this.subscriptionManager.subscribe();
  }

  /**
   * Wait for the real-time subscription to be established.
   * Called internally by openSpace/createSpace before returning the space.
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

  /** Current user's ID (for identifying own interactions) */
  get userId(): string {
    return this._userId;
  }

  /**
   * Get the conversation ID for this space instance.
   * Used for AI context tracking and echo suppression.
   */
  get conversationId(): string {
    return this._conversationId;
  }

  /**
   * Set the conversation ID for AI context tracking.
   * Emits 'conversationIdChanged' event.
   */
  set conversationId(value: string) {
    if (value === this._conversationId) return;
    const previous = this._conversationId;
    this._conversationId = value;
    this.emit('conversationIdChanged', {
      previousConversationId: previous,
      newConversationId: value,
    });
  }

  get isReadOnly(): boolean {
    return this._role === 'viewer';
  }

  // ===========================================================================
  // Conversation Access
  // ===========================================================================

  /**
   * Get interactions for this space's current conversationId.
   * Returns the interactions array.
   */
  getInteractions(): Interaction[] {
    return this._data.conversations?.[this._conversationId]?.interactions ?? [];
  }

  /**
   * Get interactions for a specific conversation ID.
   * Useful for viewing other conversations in the space.
   */
  getInteractionsById(conversationId: string): Interaction[] {
    return this._data.conversations?.[conversationId]?.interactions ?? [];
  }

  /**
   * Get all conversation IDs that have conversations in this space.
   */
  getConversationIds(): string[] {
    return Object.keys(this._data.conversations ?? {});
  }

  // ===========================================================================
  // Space Lifecycle
  // ===========================================================================

  /**
   * Rename this space.
   */
  async rename(newName: string): Promise<void> {
    const oldName = this._name;
    this._name = newName;

    try {
      await this.graphqlClient.renameSpace(this._id, newName);
    } catch (error) {
      this._name = oldName;
      throw error;
    }
  }

  /**
   * Close this space and clean up resources.
   * Stops real-time subscription and unregisters from client.
   */
  close(): void {
    this.subscriptionManager.destroy();
    this.onCloseCallback(this._id);
    this.removeAllListeners();
  }

  // ===========================================================================
  // Undo / Redo (Server-managed checkpoints)
  // ===========================================================================

  /**
   * Create a checkpoint (seal current batch of changes).
   * Patches accumulate automatically - this seals them with a label.
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
    // Server broadcasts space_patched if successful, which updates local state
    return result.success;
  }

  /**
   * Redo a previously undone batch of changes.
   * @returns true if redo was performed
   */
  async redo(): Promise<boolean> {
    const result = await this.graphqlClient.redo(this._id, this._conversationId);
    // Server broadcasts space_patched if successful, which updates local state
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
   * Returns just the data portion (RoolObject), not the full entry with meta/links.
   */
  async getObject(objectId: string): Promise<RoolObject | undefined> {
    return this._data.objects[objectId]?.data;
  }

  /**
   * Get an object's stat (audit information).
   * Returns modification timestamp and author, or undefined if object not found.
   */
  async stat(objectId: string): Promise<RoolObjectStat | undefined> {
    const entry = this._data.objects[objectId];
    if (!entry) return undefined;

    return {
      modifiedAt: entry.modifiedAt,
      modifiedBy: entry.modifiedBy,
      modifiedByName: entry.modifiedByName,
    };
  }

  /**
   * Find objects using structured filters and natural language.
   * @param options.where - Structured field requirements (exact match). Use {{placeholder}} for semantic matching.
   * @param options.prompt - Natural language query/refinement
   * @param options.limit - Maximum number of results to return
   * @param options.objectIds - Scope search to specific objects
   * @returns The matching objects and a message from the AI
   * 
   * @example
   * // Exact match
   * const { objects } = await space.findObjects({ where: { type: 'article' } });
   * 
   * @example
   * // Natural language
   * const { objects, message } = await space.findObjects({ 
   *   prompt: 'articles about space exploration' 
   * });
   * 
   * @example
   * // Combined - structured + semantic
   * const { objects } = await space.findObjects({ 
   *   where: { type: 'article', category: '{{something about food}}' },
   *   prompt: 'published in the last month',
   *   limit: 10
   * });
   */
  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    const order = options.order ?? 'desc';

    // Check if we need AI (prompt or placeholders in where)
    const needsAI =
      options.prompt ||
      (options.where && JSON.stringify(options.where).includes('{{'));

    // If no AI needed, filter locally (avoids server round trip)
    if (!needsAI) {
      // Get entries (not just data) so we can sort by modifiedAt
      let entries = Object.entries(this._data.objects);

      // Apply where clause (exact match)
      if (options.where && Object.keys(options.where).length > 0) {
        entries = entries.filter(([, entry]) =>
          Object.entries(options.where!).every(([key, value]) => entry.data[key] === value)
        );
      }

      // Apply scope filter
      if (options.objectIds && options.objectIds.length > 0) {
        const scope = new Set(options.objectIds);
        entries = entries.filter(([id]) => scope.has(id));
      }

      // Sort by modifiedAt
      entries.sort((a, b) => {
        const aTime = a[1].modifiedAt ?? 0;
        const bTime = b[1].modifiedAt ?? 0;
        return order === 'desc' ? bTime - aTime : aTime - bTime;
      });

      // Apply limit
      if (options.limit) {
        entries = entries.slice(0, options.limit);
      }

      const objects = entries.map(([, entry]) => entry.data);
      return {
        objects,
        message: `Found ${objects.length} object(s) matching criteria`,
      };
    }

    // Otherwise, use server (with AI)
    return this.graphqlClient.findObjects(this._id, options, this._conversationId);
  }

  /**
   * Get all object IDs.
   * @param options.limit - Maximum number of IDs to return
   * @param options.order - Sort order by modifiedAt ('asc' or 'desc', default: 'desc')
   */
  getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }): string[] {
    const order = options?.order ?? 'desc';

    let entries = Object.entries(this._data.objects);

    // Sort by modifiedAt
    entries.sort((a, b) => {
      const aTime = a[1].modifiedAt ?? 0;
      const bTime = b[1].modifiedAt ?? 0;
      return order === 'desc' ? bTime - aTime : aTime - bTime;
    });

    let ids = entries.map(([id]) => id);

    if (options?.limit) {
      ids = ids.slice(0, options.limit);
    }

    return ids;
  }

  /**
   * Create a new object with optional AI generation.
   * @param options.data - Object data fields (any key-value pairs). Optionally include `id` to use a custom ID. Use {{placeholder}} for AI-generated content. Fields prefixed with _ are hidden from AI.
   * @param options.prompt - AI prompt for content generation (optional).
   * @param options.ephemeral - If true, the operation won't be recorded in conversation history.
   * @returns The created object (with AI-filled content) and message
   */
  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    const { data = {}, prompt, ephemeral } = options;

    // Use data.id if provided (string), otherwise generate
    const objectId = typeof data.id === 'string' ? data.id : generateEntityId();

    // Validate ID format: alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(objectId)) {
      throw new Error(`Invalid object ID "${objectId}". IDs must contain only alphanumeric characters, hyphens, and underscores.`);
    }

    // Fail if object already exists
    if (this._data.objects[objectId]) {
      throw new Error(`Object "${objectId}" already exists`);
    }

    const dataWithId = { ...data, id: objectId };

    // Build the entry for local state (optimistic - server will overwrite audit fields)
    const entry: RoolObjectEntry = {
      links: {},
      data: dataWithId,
      modifiedAt: Date.now(),
      modifiedBy: this._userId,
      modifiedByName: null,
    };

    // Update local state immediately (optimistic)
    this._data.objects[objectId] = entry;
    this.emit('objectCreated', { objectId, object: entry.data, source: 'local_user' });

    // Await server call (may trigger AI processing that updates local state via patches)
    try {
      const message = await this.graphqlClient.createObject(this.id, dataWithId, this._conversationId, prompt, ephemeral);
      // Return current state (may have been updated by AI patches)
      return { object: this._data.objects[objectId].data, message };
    } catch (error) {
      console.error('[Space] Failed to create object:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
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
    const entry = this._data.objects[objectId];
    if (!entry) {
      throw new Error(`Object ${objectId} not found for update`);
    }

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

    // Build local updates (apply deletions and updates)
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) {
          delete entry.data[key];
        } else {
          entry.data[key] = value;
        }
      }
    }

    // Emit semantic event with updated object
    if (data) {
      this.emit('objectUpdated', { objectId, object: entry.data, source: 'local_user' });
    }

    // Await server call (may trigger AI processing that updates local state via patches)
    try {
      const message = await this.graphqlClient.updateObject(this.id, objectId, this._conversationId, serverData, options.prompt, ephemeral);
      // Return current state (may have been updated by AI patches)
      return { object: this._data.objects[objectId].data, message };
    } catch (error) {
      console.error('[Space] Failed to update object:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Delete objects by IDs.
   * Outbound links are automatically deleted with the object.
   * Inbound links become orphans (tolerated).
   */
  async deleteObjects(objectIds: string[]): Promise<void> {
    if (objectIds.length === 0) return;

    const deletedObjectIds: string[] = [];

    // Collect links that will be orphaned (for events)
    const deletedLinks: Array<{ sourceId: string; targetId: string; relation: string }> = [];
    for (const objectId of objectIds) {
      const entry = this._data.objects[objectId];
      if (entry) {
        // Collect outbound links for deletion events
        for (const [relation, targets] of Object.entries(entry.links)) {
          for (const targetId of Object.keys(targets)) {
            deletedLinks.push({ sourceId: objectId, targetId, relation });
          }
        }
      }
    }

    // Remove objects (local state)
    for (const objectId of objectIds) {
      if (this._data.objects[objectId]) {
        delete this._data.objects[objectId];
        deletedObjectIds.push(objectId);
      }
    }

    // Emit semantic events
    for (const link of deletedLinks) {
      this.emit('unlinked', { ...link, source: 'local_user' });
    }
    for (const objectId of deletedObjectIds) {
      this.emit('objectDeleted', { objectId, source: 'local_user' });
    }

    // Await server call
    try {
      await this.graphqlClient.deleteObjects(this.id, objectIds, this._conversationId);
    } catch (error) {
      console.error('[Space] Failed to delete objects:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // ===========================================================================
  // Conversation Management
  // ===========================================================================

  /**
   * Delete a conversation and its interaction history.
   * Defaults to the current conversation if no conversationId is provided.
   */
  async deleteConversation(conversationId?: string): Promise<void> {
    const targetConversationId = conversationId ?? this._conversationId;

    // Optimistic local update
    if (this._data.conversations?.[targetConversationId]) {
      delete this._data.conversations[targetConversationId];
    }

    // Emit events
    this.emit('conversationUpdated', {
      conversationId: targetConversationId,
      source: 'local_user',
    });
    this.emit('conversationsChanged', {
      action: 'deleted',
      conversationId: targetConversationId,
      source: 'local_user',
    });

    // Call server
    try {
      await this.graphqlClient.deleteConversation(this.id, targetConversationId);
    } catch (error) {
      console.error('[Space] Failed to delete conversation:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Rename a conversation.
   * If the conversation doesn't exist, it will be created with the given name.
   */
  async renameConversation(conversationId: string, name: string): Promise<void> {
    // Optimistic local update - auto-create if needed
    if (!this._data.conversations) {
      this._data.conversations = {};
    }
    const isNew = !this._data.conversations[conversationId];
    if (isNew) {
      this._data.conversations[conversationId] = {
        name,
        createdAt: Date.now(),
        createdBy: this._userId,
        interactions: [],
      };
    } else {
      this._data.conversations[conversationId].name = name;
    }

    // Emit events
    this.emit('conversationUpdated', {
      conversationId,
      source: 'local_user',
    });
    this.emit('conversationsChanged', {
      action: isNew ? 'created' : 'renamed',
      conversationId,
      name,
      source: 'local_user',
    });

    // Call server
    try {
      await this.graphqlClient.renameConversation(this.id, conversationId, name);
    } catch (error) {
      console.error('[Space] Failed to rename conversation:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * List all conversations in this space with summary info.
   */
  async listConversations(): Promise<ConversationInfo[]> {
    return this.graphqlClient.listConversations(this.id);
  }

  /**
   * Get the system instruction for the current conversation.
   * Returns undefined if no system instruction is set.
   */
  getSystemInstruction(): string | undefined {
    return this._data.conversations?.[this._conversationId]?.systemInstruction;
  }

  /**
   * Set the system instruction for the current conversation.
   * Pass null to clear the instruction.
   */
  async setSystemInstruction(instruction: string | null): Promise<void> {
    // Optimistic local update
    if (!this._data.conversations) {
      this._data.conversations = {};
    }
    if (!this._data.conversations[this._conversationId]) {
      this._data.conversations[this._conversationId] = {
        createdAt: Date.now(),
        createdBy: this._userId,
        interactions: [],
      };
    }
    if (instruction === null) {
      delete this._data.conversations[this._conversationId].systemInstruction;
    } else {
      this._data.conversations[this._conversationId].systemInstruction = instruction;
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
      console.error('[Space] Failed to set system instruction:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // ===========================================================================
  // Link Operations
  // ===========================================================================

  /**
   * Create a link between objects.
   * Links are stored on the source object.
   */
  async link(
    sourceId: string,
    relation: string,
    targetId: string
  ): Promise<void> {
    const entry = this._data.objects[sourceId];
    if (!entry) {
      throw new Error(`Source object ${sourceId} not found`);
    }

    // Update local state immediately
    if (!entry.links[relation]) {
      entry.links[relation] = [];
    }
    if (!entry.links[relation].includes(targetId)) {
      entry.links[relation].push(targetId);
    }

    this.emit('linked', { sourceId, relation, targetId, source: 'local_user' });

    // Await server call
    try {
      await this.graphqlClient.link(this.id, sourceId, relation, targetId, this._conversationId);
    } catch (error) {
      console.error('[Space] Failed to create link:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Remove links from a source object.
   * Three forms:
   * - unlink(source, relation, target): remove one specific link
   * - unlink(source, relation): clear all targets for that relation
   * - unlink(source): clear ALL relations on the source
   * @returns true if any links were removed
   */
  async unlink(sourceId: string, relation?: string, targetId?: string): Promise<boolean> {
    const entry = this._data.objects[sourceId];
    if (!entry) {
      throw new Error(`Source object ${sourceId} not found`);
    }

    const deletedLinks: Array<{ relation: string; targetId: string }> = [];

    // Update local state based on which parameters are provided
    if (relation && targetId) {
      // Remove one specific link: source.relation -> target
      const existing = entry.links[relation] ?? [];
      if (existing.includes(targetId)) {
        entry.links[relation] = existing.filter(t => t !== targetId);
        if (entry.links[relation].length === 0) {
          delete entry.links[relation];
        }
        deletedLinks.push({ relation, targetId });
      }
    } else if (relation && !targetId) {
      // Clear all targets for this relation
      if (entry.links[relation]) {
        for (const target of entry.links[relation]) {
          deletedLinks.push({ relation, targetId: target });
        }
        delete entry.links[relation];
      }
    } else if (!relation && !targetId) {
      // Clear ALL relations on the source
      for (const [rel, targets] of Object.entries(entry.links)) {
        for (const target of targets) {
          deletedLinks.push({ relation: rel, targetId: target });
        }
        delete entry.links[rel];
      }
    }

    // Emit semantic events
    for (const link of deletedLinks) {
      this.emit('unlinked', { sourceId, relation: link.relation, targetId: link.targetId, source: 'local_user' });
    }

    // Await server call
    try {
      await this.graphqlClient.unlink(this.id, sourceId, relation, targetId, this._conversationId);
    } catch (error) {
      console.error('[Space] Failed to remove link:', error);
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    return deletedLinks.length > 0;
  }

  /**
   * Get parent objects (objects that have links pointing TO this object).
   * @param relation - Optional filter by relation name
   * @param options.limit - Maximum number of parents to return
   * @param options.order - Sort order by modifiedAt ('asc' or 'desc', default: 'desc')
   */
  async getParents(
    objectId: string,
    relation?: string,
    options?: { limit?: number; order?: 'asc' | 'desc' }
  ): Promise<RoolObject[]> {
    const order = options?.order ?? 'desc';
    const parentEntries: [string, RoolObjectEntry][] = [];

    for (const [id, entry] of Object.entries(this._data.objects)) {
      for (const [rel, targets] of Object.entries(entry.links)) {
        if ((!relation || rel === relation) && targets.includes(objectId)) {
          parentEntries.push([id, entry]);
          break; // Found a link, move to next object
        }
      }
    }

    // Sort by modifiedAt
    parentEntries.sort((a, b) => {
      const aTime = a[1].modifiedAt ?? 0;
      const bTime = b[1].modifiedAt ?? 0;
      return order === 'desc' ? bTime - aTime : aTime - bTime;
    });

    let parents = parentEntries.map(([, entry]) => entry.data);

    if (options?.limit) {
      parents = parents.slice(0, options.limit);
    }

    return parents;
  }

  /**
   * Get child objects (objects that this object has links pointing TO).
   * Filters out orphan targets (targets that don't exist).
   * @param relation - Optional filter by relation name
   * @param options.limit - Maximum number of children to return
   * @param options.order - Sort order by modifiedAt ('asc' or 'desc', default: 'desc')
   */
  async getChildren(
    objectId: string,
    relation?: string,
    options?: { limit?: number; order?: 'asc' | 'desc' }
  ): Promise<RoolObject[]> {
    const entry = this._data.objects[objectId];
    if (!entry) return [];

    const order = options?.order ?? 'desc';
    const childEntries: [string, RoolObjectEntry][] = [];

    for (const [rel, targets] of Object.entries(entry.links)) {
      if (!relation || rel === relation) {
        for (const targetId of targets) {
          // Filter orphans - only include existing targets
          const targetEntry = this._data.objects[targetId];
          if (targetEntry) {
            childEntries.push([targetId, targetEntry]);
          }
        }
      }
    }

    // Sort by modifiedAt
    childEntries.sort((a, b) => {
      const aTime = a[1].modifiedAt ?? 0;
      const bTime = b[1].modifiedAt ?? 0;
      return order === 'desc' ? bTime - aTime : aTime - bTime;
    });

    let children = childEntries.map(([, entry]) => entry.data);

    if (options?.limit) {
      children = children.slice(0, options.limit);
    }

    return children;
  }

  /**
   * Get all child object IDs including orphans (targets that may not exist).
   * @param relation - Optional filter by relation name
   */
  getChildrenIncludingOrphans(objectId: string, relation?: string): string[] {
    const entry = this._data.objects[objectId];
    if (!entry) return [];

    const children: string[] = [];
    for (const [rel, targets] of Object.entries(entry.links)) {
      if (!relation || rel === relation) {
        children.push(...targets);
      }
    }
    return children;
  }

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  /**
   * Set a space-level metadata value.
   * Metadata is stored in meta and hidden from AI operations.
   */
  setMetadata(key: string, value: unknown): void {
    if (!this._data.meta) {
      this._data.meta = {};
    }
    this._data.meta[key] = value;
    this.emit('metadataUpdated', { metadata: this._data.meta, source: 'local_user' });

    // Fire-and-forget server call - errors trigger resync
    this.graphqlClient.setSpaceMeta(this.id, this._data.meta, this._conversationId)
      .catch((error) => {
        console.error('[Space] Failed to set meta:', error);
        this.resyncFromServer(error instanceof Error ? error : new Error(String(error)));
      });
  }

  /**
   * Get a space-level metadata value.
   */
  getMetadata(key: string): unknown {
    return this._data.meta?.[key];
  }

  /**
   * Get all space-level metadata.
   */
  getAllMetadata(): Record<string, unknown> {
    return this._data.meta ?? {};
  }

  // ===========================================================================
  // AI Operations
  // ===========================================================================

  /**
   * Send a prompt to the AI agent for space manipulation.
   * @returns The message from the AI and the list of objects that were created or modified
   */
  async prompt(prompt: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    const result = await this.graphqlClient.prompt(this._id, prompt, this._conversationId, options);
    
    // Hydrate modified object IDs to actual objects (filter out deleted ones)
    const objects = result.modifiedObjectIds
      .map(id => this._data.objects[id]?.data)
      .filter((obj): obj is RoolObject => obj !== undefined);
    
    return {
      message: result.message,
      objects,
    };
  }

  // ===========================================================================
  // Collaboration
  // ===========================================================================

  /**
   * List users with access to this space.
   */
  async listUsers(): Promise<SpaceMember[]> {
    return this.graphqlClient.listSpaceUsers(this._id);
  }

  /**
   * Add a user to this space with specified role.
   */
  async addUser(userId: string, role: RoolUserRole): Promise<void> {
    return this.graphqlClient.addSpaceUser(this._id, userId, role);
  }

  /**
   * Remove a user from this space.
   */
  async removeUser(userId: string): Promise<void> {
    return this.graphqlClient.removeSpaceUser(this._id, userId);
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
  // Low-level Operations
  // ===========================================================================

  /**
   * Get the full space data.
   * Use sparingly - prefer specific operations.
   */
  getData(): RoolSpaceData {
    return this._data;
  }

  // ===========================================================================
  // Import/Export
  // ===========================================================================

  /**
   * Export space data as JSON-LD.
   * Returns a JSON-LD document with all objects and their relations.
   * Space metadata and interaction history are not included.
   */
  export(): JsonLdDocument {
    return toJsonLd(this._data);
  }

  /**
   * Import JSON-LD data into the space.
   * Creates objects and links from the JSON-LD graph.
   * Space must be empty (throws if objects exist).
   */
  async import(data: unknown): Promise<void> {
    if (Object.keys(this._data.objects).length > 0) {
      throw new Error(
        'Cannot import into non-empty space. Create a new space or delete existing objects first.'
      );
    }

    const parsed = fromJsonLd(data);

    // Create all objects first
    for (const obj of parsed.objects) {
      await this.createObject({ data: obj.data });
    }

    // Then create all links
    for (const obj of parsed.objects) {
      for (const rel of obj.relations) {
        await this.link(obj.id, rel.relation, rel.targetId);
      }
    }
  }

  /**
   * Export space data and media as a zip archive.
   * Media URLs are rewritten to relative paths within the archive.
   * @returns A Blob containing the zip archive
   */
  async exportArchive(): Promise<Blob> {
    // Get JSON-LD export
    const jsonld = this.export();

    // Get all media in this space
    const mediaList = await this.listMedia();
    const mediaUrls = new Set(mediaList.map(m => m.url));

    // Find which media URLs are actually used in the export
    const allStrings = findAllStrings(jsonld);
    const usedMediaUrls = [...allStrings].filter(s => mediaUrls.has(s));

    // Build URL mapping and fetch media files
    const urlMapping = new Map<string, string>();
    const files: Record<string, Uint8Array> = {};

    for (const url of usedMediaUrls) {
      const mediaInfo = mediaList.find(m => m.url === url);
      if (!mediaInfo) continue;

      try {
        const response = await this.fetchMedia(url);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();

        // Determine filename: uuid + extension from content type
        const ext = getExtensionFromContentType(response.contentType);
        const filename = `${mediaInfo.uuid}${ext}`;
        const relativePath = `media/${filename}`;

        files[relativePath] = new Uint8Array(buffer);
        urlMapping.set(url, relativePath);
      } catch (error) {
        // Skip media that fails to fetch (e.g., 404)
        console.warn(`[Space] Failed to fetch media for archive: ${url}`, error);
      }
    }

    // Rewrite URLs in JSON-LD
    const rewrittenJsonld = rewriteStrings(jsonld, urlMapping);

    // Add data.json to the archive
    const encoder = new TextEncoder();
    files['data.json'] = encoder.encode(JSON.stringify(rewrittenJsonld, null, 2));

    // Create zip archive
    const zipped = zipSync(files);
    return new Blob([zipped as BlobPart], { type: 'application/zip' });
  }

  /**
   * Import from a zip archive containing data.json and media files.
   * Space must be empty (throws if objects exist).
   */
  async importArchive(archive: Blob): Promise<void> {
    if (Object.keys(this._data.objects).length > 0) {
      throw new Error(
        'Cannot import into non-empty space. Create a new space or delete existing objects first.'
      );
    }

    // Read and unzip the archive
    const buffer = await archive.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));

    // Parse data.json
    const dataJsonBytes = unzipped['data.json'];
    if (!dataJsonBytes) {
      throw new Error('Invalid archive: missing data.json');
    }
    const decoder = new TextDecoder();
    const jsonld = JSON.parse(decoder.decode(dataJsonBytes)) as JsonLdDocument;

    // Upload media files and build URL mapping
    const urlMapping = new Map<string, string>();
    for (const [path, data] of Object.entries(unzipped)) {
      if (!path.startsWith('media/')) continue;

      const contentType = getContentTypeFromFilename(path);
      const blob = new Blob([data as BlobPart], { type: contentType });
      const newUrl = await this.uploadMedia(blob);
      urlMapping.set(path, newUrl);
    }

    // Rewrite URLs in JSON-LD
    const rewrittenJsonld = rewriteStrings(jsonld, urlMapping);

    // Import using existing logic
    const parsed = fromJsonLd(rewrittenJsonld);

    // Create all objects first
    for (const obj of parsed.objects) {
      await this.createObject({ data: obj.data });
    }

    // Then create all links
    for (const obj of parsed.objects) {
      for (const rel of obj.relations) {
        await this.link(obj.id, rel.relation, rel.targetId);
      }
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
    switch (event.type) {
      case 'space_patched':
        if (event.patch) {
          this.handleRemotePatch(event.patch, event.source);
        }
        break;

      case 'space_changed':
        // Full reload needed
        void this.graphqlClient.getSpace(this._id).then(({ data }) => {
          this._data = data;
          this.emit('reset', { source: 'remote_user' });
        });
        break;
    }
  }

  /**
   * Check if a patch would actually change the current data.
   * Used to deduplicate events when patches don't change anything (e.g., optimistic updates).
   * @internal
   */
  private didPatchChangeAnything(patch: JSONPatchOp[]): boolean {
    for (const op of patch) {
      const pathParts = op.path.split('/').filter(p => p);
      let current: any = this._data;
      for (const part of pathParts) {
        current = current?.[part];
      }
      
      if (op.op === 'remove' && current !== undefined) return true;
      if ((op.op === 'add' || op.op === 'replace') && 
          JSON.stringify(current) !== JSON.stringify((op as any).value)) return true;
    }
    return false;
  }

  /**
   * Handle a patch event from another client.
   * Checks for version gaps to detect missed patches.
   * @internal
   */
  private handleRemotePatch(patch: JSONPatchOp[], source: RoolEventSource): void {
    // Extract the new version from the patch
    const versionOp = patch.find(
      op => op.path === '/version' && (op.op === 'add' || op.op === 'replace')
    ) as { op: 'add' | 'replace'; path: string; value: number } | undefined;

    if (versionOp) {
      const incomingVersion = versionOp.value;
      const currentVersion = this._data.version ?? 0;
      const expectedVersion = currentVersion + 1;

      // Check for version gap (missed patches)
      if (incomingVersion > expectedVersion) {
        console.warn(
          `[Space] Version gap detected: expected ${expectedVersion}, got ${incomingVersion}. Resyncing.`
        );
        this.resyncFromServer(new Error(`Version gap: expected ${expectedVersion}, got ${incomingVersion}`))
          .catch(() => { });
        return;
      }

      // Skip stale patches (version <= current, already applied)
      if (incomingVersion <= currentVersion) {
        return;
      }
    }

    // Check if patch would change anything BEFORE applying
    const willChange = this.didPatchChangeAnything(patch);

    try {
      this._data = immutableJSONPatch(this._data, patch) as RoolSpaceData;
    } catch (error) {
      console.error('[Space] Failed to apply remote patch:', error);
      // Force resync on patch error
      this.resyncFromServer(error instanceof Error ? error : new Error(String(error))).catch(() => { });
      return;
    }

    // Only emit events if something actually changed
    if (willChange) {
      const changeSource: ChangeSource = source === 'agent' ? 'remote_agent' : 'remote_user';
      this.emitSemanticEventsFromPatch(patch, changeSource);
    }
  }

  /**
   * Parse JSON patch operations and emit semantic events.
   * @internal
   */
  private emitSemanticEventsFromPatch(patch: JSONPatchOp[], source: ChangeSource): void {
    // Track which objects have been updated (to avoid duplicate events)
    const updatedObjects = new Set<string>();

    for (const op of patch) {
      const { path } = op;

      // Object operations: /objects/{objectId}/...
      if (path.startsWith('/objects/')) {
        const parts = path.split('/');
        const objectId = parts[2];

        if (parts.length === 3) {
          // /objects/{objectId} - full object add or remove
          if (op.op === 'add') {
            const entry = this._data.objects[objectId];
            if (entry) {
              this.emit('objectCreated', { objectId, object: entry.data, source });
            }
          } else if (op.op === 'remove') {
            this.emit('objectDeleted', { objectId, source });
          }
        } else if (parts[3] === 'data') {
          // /objects/{objectId}/data/... - data field update
          if (!updatedObjects.has(objectId)) {
            const entry = this._data.objects[objectId];
            if (entry) {
              this.emit('objectUpdated', { objectId, object: entry.data, source });
              updatedObjects.add(objectId);
            }
          }
        } else if (parts[3] === 'links') {
          // /objects/{objectId}/links/{relation} - links are arrays of target IDs
          if (parts.length === 5) {
            const relation = parts[4];

            if (op.op === 'add' || op.op === 'replace') {
              // New relation added or replaced - emit linked for all targets in the array
              const targets = this._data.objects[objectId]?.links[relation] ?? [];
              for (const targetId of targets) {
                this.emit('linked', { sourceId: objectId, relation, targetId, source });
              }
            } else if (op.op === 'remove') {
              // Relation removed - we don't have the old targets, so we can't emit individual unlinked events
              // The targets were already removed from local state by applyPatch before this runs
            }
          }
        }
      }
      else if (path === '/meta' || path.startsWith('/meta/')) {
        this.emit('metadataUpdated', { metadata: this._data.meta, source });
      }
      // Conversation operations: /conversations/{conversationId} or /conversations/{conversationId}/...
      else if (path.startsWith('/conversations/')) {
        const parts = path.split('/');
        const conversationId = parts[2];
        if (conversationId) {
          this.emit('conversationUpdated', { conversationId, source });

          // Emit conversationsChanged for list-level changes
          if (parts.length === 3) {
            // /conversations/{conversationId} - full conversation add or remove
            if (op.op === 'add') {
              const conv = this._data.conversations?.[conversationId];
              this.emit('conversationsChanged', {
                action: 'created',
                conversationId,
                name: conv?.name,
                source,
              });
            } else if (op.op === 'remove') {
              this.emit('conversationsChanged', {
                action: 'deleted',
                conversationId,
                source,
              });
            }
          } else if (parts[3] === 'name') {
            // /conversations/{conversationId}/name - rename
            const conv = this._data.conversations?.[conversationId];
            this.emit('conversationsChanged', {
              action: 'renamed',
              conversationId,
              name: conv?.name,
              source,
            });
          }
        }
      }
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async resyncFromServer(originalError?: Error): Promise<void> {
    console.warn('[Space] Resyncing from server after sync failure');
    try {
      const { data } = await this.graphqlClient.getSpace(this._id);
      this._data = data;
      // Clear history is now async but we don't need to wait for it during resync
      // (it's a server-side cleanup that can happen in background)
      this.clearHistory().catch((err) => {
        console.warn('[Space] Failed to clear history during resync:', err);
      });
      this.emit('syncError', originalError ?? new Error('Sync failed'));
      this.emit('reset', { source: 'system' });
    } catch (error) {
      console.error('[Space] Failed to resync from server:', error);
      // Still emit syncError with the original error
      this.emit('syncError', originalError ?? new Error('Sync failed'));
    }
  }
}
