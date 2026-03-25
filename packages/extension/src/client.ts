/**
 * Extension-side bridge client.
 *
 * `initExtension()` waits for the host handshake, then returns a `Channel`
 * that mirrors the RoolChannel API over postMessage.
 */

import type { BridgeInit, BridgeResponse, BridgeEvent } from './protocol.js';
import { isBridgeMessage } from './protocol.js';
import type {
  RoolObject,
  RoolObjectStat,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  Interaction,
  ConversationInfo,
  PromptOptions,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  RoolUserRole,
  LinkAccess,
  ChannelEvents,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 0;
function nextRequestId(): string {
  return `req-${++_nextId}-${Date.now().toString(36)}`;
}

type EventName = keyof ChannelEvents;
type EventCallback = (...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export class Channel {
  private _pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _listeners = new Map<string, Set<EventCallback>>();

  // Metadata from handshake
  readonly channelId: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly role: RoolUserRole;
  readonly linkAccess: LinkAccess;
  readonly userId: string;

  private _schema: SpaceSchema;
  private _metadata: Record<string, unknown>;

  constructor(init: BridgeInit) {
    this.channelId = init.channelId;
    this.spaceId = init.spaceId;
    this.spaceName = init.spaceName;
    this.role = init.role as RoolUserRole;
    this.linkAccess = init.linkAccess as LinkAccess;
    this.userId = init.userId;
    this._schema = init.schema as SpaceSchema;
    this._metadata = init.metadata;

    window.addEventListener('message', this._onMessage);
  }

  get isReadOnly(): boolean {
    return this.role === 'viewer';
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  on<E extends EventName>(event: E, callback: (data: ChannelEvents[E]) => void): void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(callback as EventCallback);
  }

  off<E extends EventName>(event: E, callback: (data: ChannelEvents[E]) => void): void {
    this._listeners.get(event)?.delete(callback as EventCallback);
  }

  private _emit(event: string, data: unknown): void {
    const set = this._listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[Channel] Error in ${event} listener:`, e);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // postMessage transport
  // ---------------------------------------------------------------------------

  private _call(method: string, ...args: unknown[]): Promise<unknown> {
    return this._callScoped(method, args);
  }

  /**
   * Send a bridge request, optionally scoped to a conversation.
   * Used internally by Channel (no conversationId) and ConversationHandle.
   * @internal
   */
  _callScoped(method: string, args: unknown[], conversationId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextRequestId();
      this._pending.set(id, { resolve, reject });
      const msg: Record<string, unknown> = { type: 'rool:request', id, method, args };
      if (conversationId !== undefined) msg.conversationId = conversationId;
      window.parent.postMessage(msg, '*');
    });
  }

  private _onMessage = (event: MessageEvent): void => {
    if (!isBridgeMessage(event.data)) return;

    if (event.data.type === 'rool:response') {
      const msg = event.data as BridgeResponse;
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (event.data.type === 'rool:event') {
      const msg = event.data as BridgeEvent;

      // Update local caches before emitting so listeners see fresh data
      if (msg.name === 'metadataUpdated') {
        const payload = msg.data as { metadata: Record<string, unknown> };
        this._metadata = payload.metadata;
      } else if (msg.name === 'schemaUpdated') {
        const payload = msg.data as { schema: Record<string, unknown> };
        this._schema = payload.schema as SpaceSchema;
      } else if (msg.name === 'reset') {
        // Full reload happened on the host — refresh cached schema and metadata
        Promise.all([
          this._call('getSchema'),
          this._call('getAllMetadata'),
        ]).then(([schema, metadata]) => {
          this._schema = schema as SpaceSchema;
          this._metadata = metadata as Record<string, unknown>;
        });
      }

      this._emit(msg.name, msg.data);
      return;
    }
  };

  // ---------------------------------------------------------------------------
  // Channel API — mirrors RoolChannel
  // ---------------------------------------------------------------------------

  // Object operations

  async getObject(objectId: string): Promise<RoolObject | undefined> {
    return this._call('getObject', objectId) as Promise<RoolObject | undefined>;
  }

  async stat(objectId: string): Promise<RoolObjectStat | undefined> {
    return this._call('stat', objectId) as Promise<RoolObjectStat | undefined>;
  }

  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this._call('findObjects', options) as Promise<{ objects: RoolObject[]; message: string }>;
  }

  async getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }): Promise<string[]> {
    return this._call('getObjectIds', options) as Promise<string[]>;
  }

  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._call('createObject', options) as Promise<{ object: RoolObject; message: string }>;
  }

  async updateObject(objectId: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._call('updateObject', objectId, options) as Promise<{ object: RoolObject; message: string }>;
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    await this._call('deleteObjects', objectIds);
  }

  // Schema

  getSchema(): SpaceSchema {
    return this._schema;
  }

  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    const result = await this._call('createCollection', name, fields) as CollectionDef;
    this._schema[name] = result;
    return result;
  }

  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    const result = await this._call('alterCollection', name, fields) as CollectionDef;
    this._schema[name] = result;
    return result;
  }

  async dropCollection(name: string): Promise<void> {
    await this._call('dropCollection', name);
    delete this._schema[name];
  }

  // Interactions & system instruction

  async getInteractions(): Promise<Interaction[]> {
    return this._call('getInteractions') as Promise<Interaction[]>;
  }

  async getTree(): Promise<Record<string, Interaction>> {
    return this._call('getTree') as Promise<Record<string, Interaction>>;
  }

  async getActiveLeafId(): Promise<string | undefined> {
    return this._call('getActiveLeafId') as Promise<string | undefined>;
  }

  async setActiveLeaf(interactionId: string): Promise<void> {
    await this._call('setActiveLeaf', interactionId);
  }

  async getSystemInstruction(): Promise<string | undefined> {
    return this._call('getSystemInstruction') as Promise<string | undefined>;
  }

  async setSystemInstruction(instruction: string | null): Promise<void> {
    await this._call('setSystemInstruction', instruction);
  }

  async getConversations(): Promise<ConversationInfo[]> {
    return this._call('getConversations') as Promise<ConversationInfo[]>;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this._call('deleteConversation', conversationId);
  }

  async renameConversation(name: string): Promise<void> {
    await this._call('renameConversation', name);
  }

  // Conversations

  /**
   * Get a handle for a specific conversation within this channel.
   * Scopes AI and mutation operations to that conversation's interaction history.
   * Conversations are auto-created on first interaction.
   */
  conversation(conversationId: string): ConversationHandle {
    return new ConversationHandle(this, conversationId);
  }

  // Metadata

  async setMetadata(key: string, value: unknown): Promise<void> {
    await this._call('setMetadata', key, value);
    this._metadata[key] = value;
  }

  getMetadata(key: string): unknown {
    return this._metadata[key];
  }

  getAllMetadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  // AI

  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._call('prompt', text, options) as Promise<{ message: string; objects: RoolObject[] }>;
  }

  // Undo/redo

  async checkpoint(label?: string): Promise<string> {
    return this._call('checkpoint', label) as Promise<string>;
  }

  async canUndo(): Promise<boolean> {
    return this._call('canUndo') as Promise<boolean>;
  }

  async canRedo(): Promise<boolean> {
    return this._call('canRedo') as Promise<boolean>;
  }

  async undo(): Promise<boolean> {
    return this._call('undo') as Promise<boolean>;
  }

  async redo(): Promise<boolean> {
    return this._call('redo') as Promise<boolean>;
  }

  async clearHistory(): Promise<void> {
    await this._call('clearHistory');
  }

  // Cleanup

  destroy(): void {
    window.removeEventListener('message', this._onMessage);
    for (const { reject } of this._pending.values()) {
      reject(new Error('Channel destroyed'));
    }
    this._pending.clear();
    this._listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// ConversationHandle
// ---------------------------------------------------------------------------

/**
 * A conversation handle for the extension bridge.
 * Mirrors the SDK's ConversationHandle API over postMessage.
 *
 * Scopes AI and mutation operations to a specific conversation's
 * interaction history, while sharing the channel's bridge connection.
 *
 * Obtain via `channel.conversation('thread-id')`.
 */
export class ConversationHandle {
  private _channel: Channel;
  private _conversationId: string;

  /** @internal */
  constructor(channel: Channel, conversationId: string) {
    this._channel = channel;
    this._conversationId = conversationId;
  }

  /** The conversation ID this handle is scoped to. */
  get conversationId(): string { return this._conversationId; }

  // Conversation history

  async getInteractions(): Promise<Interaction[]> {
    return this._channel._callScoped('getInteractions', [], this._conversationId) as Promise<Interaction[]>;
  }

  async getTree(): Promise<Record<string, Interaction>> {
    return this._channel._callScoped('getTree', [], this._conversationId) as Promise<Record<string, Interaction>>;
  }

  async getActiveLeafId(): Promise<string | undefined> {
    return this._channel._callScoped('getActiveLeafId', [], this._conversationId) as Promise<string | undefined>;
  }

  async setActiveLeaf(interactionId: string): Promise<void> {
    await this._channel._callScoped('setActiveLeaf', [interactionId], this._conversationId);
  }

  async getSystemInstruction(): Promise<string | undefined> {
    return this._channel._callScoped('getSystemInstruction', [], this._conversationId) as Promise<string | undefined>;
  }

  async setSystemInstruction(instruction: string | null): Promise<void> {
    await this._channel._callScoped('setSystemInstruction', [instruction], this._conversationId);
  }

  async rename(name: string): Promise<void> {
    await this._channel._callScoped('renameConversation', [name], this._conversationId);
  }

  // Object operations

  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this._channel._callScoped('findObjects', [options], this._conversationId) as Promise<{ objects: RoolObject[]; message: string }>;
  }

  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._channel._callScoped('createObject', [options], this._conversationId) as Promise<{ object: RoolObject; message: string }>;
  }

  async updateObject(objectId: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._channel._callScoped('updateObject', [objectId, options], this._conversationId) as Promise<{ object: RoolObject; message: string }>;
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    await this._channel._callScoped('deleteObjects', [objectIds], this._conversationId);
  }

  // AI

  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._channel._callScoped('prompt', [text, options], this._conversationId) as Promise<{ message: string; objects: RoolObject[] }>;
  }

  // Schema

  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this._channel._callScoped('createCollection', [name, fields], this._conversationId) as Promise<CollectionDef>;
  }

  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this._channel._callScoped('alterCollection', [name, fields], this._conversationId) as Promise<CollectionDef>;
  }

  async dropCollection(name: string): Promise<void> {
    await this._channel._callScoped('dropCollection', [name], this._conversationId);
  }

  // Metadata

  async setMetadata(key: string, value: unknown): Promise<void> {
    await this._channel._callScoped('setMetadata', [key, value], this._conversationId);
  }
}

// ---------------------------------------------------------------------------
// initExtension
// ---------------------------------------------------------------------------

/**
 * Initialize the extension bridge. Call this once at startup.
 *
 * Sends `rool:ready` to the host and waits for `rool:init` with channel metadata.
 * Returns a `Channel` that mirrors the RoolChannel API over postMessage.
 *
 * If the extension is opened directly (not in an iframe), redirects to the Rool
 * console with `?openExtension={extensionId}` so the user can install or navigate to it.
 *
 * @param timeout - How long to wait for the handshake (ms). Default: 10000.
 */
export function initExtension(timeout = 10000): Promise<Channel> {
  // Deep link: if not in an iframe, redirect to the Rool console
  if (window.self === window.top) {
    const host = window.location.hostname;
    const dot = host.indexOf('.');
    if (dot > 0) {
      const extensionId = host.slice(0, dot);
      const domain = host.slice(dot + 1);
      window.location.href = `https://${domain}/?openExtension=${extensionId}`;
    }
    // Never resolve — the redirect will unload the page
    return new Promise<Channel>(() => {});
  }

  return new Promise<Channel>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Extension handshake timed out — is this running inside a Rool host?'));
    }, timeout);

    function onMessage(event: MessageEvent): void {
      if (!isBridgeMessage(event.data) || event.data.type !== 'rool:init') return;

      clearTimeout(timer);
      window.removeEventListener('message', onMessage);

      const channel = new Channel(event.data as BridgeInit);
      resolve(channel);
    }

    window.addEventListener('message', onMessage);

    // Signal to the host that we're ready
    window.parent.postMessage({ type: 'rool:ready' }, '*');
  });
}
