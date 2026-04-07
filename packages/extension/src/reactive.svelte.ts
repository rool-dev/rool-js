/**
 * Extension channel — bridge client with Svelte 5 reactivity.
 *
 * Handles the postMessage bridge to the host and provides reactive $state
 * properties, matching the @rool-dev/svelte ReactiveChannel API.
 */

import type { BridgeInit, BridgeResponse, BridgeEvent, BridgeUser, ColorScheme } from './protocol.js';
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
// WatchOptions
// ---------------------------------------------------------------------------

export interface WatchOptions {
  where?: Record<string, unknown>;
  collection?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// ReactiveWatch
// ---------------------------------------------------------------------------

class ReactiveWatchImpl {
  #channel: ReactiveChannelImpl;
  #options: WatchOptions;
  #unsubscribers: (() => void)[] = [];
  #currentIds = new Set<string>();

  objects = $state<RoolObject[]>([]);
  loading = $state(true);

  constructor(channel: ReactiveChannelImpl, options: WatchOptions) {
    this.#channel = channel;
    this.#options = options;
    this.#setup();
  }

  #setup() {
    this.refresh();

    const onObjectCreated = ({ object }: { object: RoolObject }) => {
      if (this.#matches(object)) this.refresh();
    };
    this.#channel.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#channel.off('objectCreated', onObjectCreated));

    const onObjectUpdated = ({ objectId, object }: { objectId: string; object: RoolObject }) => {
      const wasIn = this.#currentIds.has(objectId);
      const nowMatches = this.#matches(object);

      if (wasIn && nowMatches) {
        const i = this.objects.findIndex((o) => o.id === objectId);
        if (i !== -1) this.objects[i] = { ...this.objects[i], ...object };
      } else if (wasIn && !nowMatches) {
        const where = this.#options.where;
        const isPartial = where && Object.keys(where).some((k) => !(k in object));
        if (isPartial) {
          const i = this.objects.findIndex((o) => o.id === objectId);
          if (i !== -1) this.objects[i] = { ...this.objects[i], ...object };
        } else {
          this.objects = this.objects.filter((o) => o.id !== objectId);
          this.#currentIds.delete(objectId);
        }
      } else if (!wasIn && nowMatches) {
        this.refresh();
      }
    };
    this.#channel.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#channel.off('objectUpdated', onObjectUpdated));

    const onObjectDeleted = ({ objectId }: { objectId: string }) => {
      if (this.#currentIds.has(objectId)) {
        this.objects = this.objects.filter((o) => o.id !== objectId);
        this.#currentIds.delete(objectId);
      }
    };
    this.#channel.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#channel.off('objectDeleted', onObjectDeleted));

    const onReset = () => this.refresh();
    this.#channel.on('reset', onReset);
    this.#unsubscribers.push(() => this.#channel.off('reset', onReset));
  }

  #matches(object: RoolObject): boolean {
    // Collection membership is shape-based and resolved server-side — can't match locally
    if (this.#options.collection) return true;

    const where = this.#options.where;
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (object[key] !== value) return false;
    }
    return true;
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const { objects } = await this.#channel.findObjects({
        where: this.#options.where,
        collection: this.#options.collection,
        limit: this.#options.limit,
        order: this.#options.order,
        ephemeral: true,
      });
      this.objects = objects;
      this.#currentIds = new Set(objects.map((o) => o.id));
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveWatch = ReactiveWatchImpl;

// ---------------------------------------------------------------------------
// ReactiveObject
// ---------------------------------------------------------------------------

class ReactiveObjectImpl {
  #channel: ReactiveChannelImpl;
  #objectId: string;
  #unsubscribers: (() => void)[] = [];

  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(channel: ReactiveChannelImpl, objectId: string) {
    this.#channel = channel;
    this.#objectId = objectId;
    this.#setup();
  }

  #setup() {
    this.refresh();

    const onObjectUpdated = ({ objectId, object }: { objectId: string; object: RoolObject }) => {
      if (objectId === this.#objectId) this.data = object;
    };
    this.#channel.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#channel.off('objectUpdated', onObjectUpdated));

    const onObjectCreated = ({ object }: { object: RoolObject }) => {
      if (object.id === this.#objectId) this.data = object;
    };
    this.#channel.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#channel.off('objectCreated', onObjectCreated));

    const onObjectDeleted = ({ objectId }: { objectId: string }) => {
      if (objectId === this.#objectId) this.data = undefined;
    };
    this.#channel.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#channel.off('objectDeleted', onObjectDeleted));

    const onReset = () => this.refresh();
    this.#channel.on('reset', onReset);
    this.#unsubscribers.push(() => this.#channel.off('reset', onReset));
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.data = await this.#channel.getObject(this.#objectId);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveObject = ReactiveObjectImpl;

// ---------------------------------------------------------------------------
// Color scheme helper
// ---------------------------------------------------------------------------

function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.classList.toggle('dark', scheme === 'dark');
}

// ---------------------------------------------------------------------------
// ReactiveChannel
// ---------------------------------------------------------------------------

class ReactiveChannelImpl {
  private _pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _listeners = new Map<string, Set<EventCallback>>();
  private _schema: SpaceSchema;
  private _metadata: Record<string, unknown>;
  #unsubscribers: (() => void)[] = [];
  #closed = false;

  // Metadata from handshake
  readonly channelId: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly role: RoolUserRole;
  readonly linkAccess: LinkAccess;
  readonly userId: string;
  /** Current user info (id, name, email). */
  readonly user: BridgeUser;

  // Reactive state
  interactions = $state<Interaction[]>([]);
  objectIds = $state<string[]>([]);
  collections = $state<string[]>([]);
  conversations = $state<ConversationInfo[]>([]);
  colorScheme = $state<ColorScheme>('light');

  constructor(init: BridgeInit) {
    this.channelId = init.channelId;
    this.spaceId = init.spaceId;
    this.spaceName = init.spaceName;
    this.role = init.role as RoolUserRole;
    this.linkAccess = init.linkAccess as LinkAccess;
    this.userId = init.userId;
    this.user = init.user;
    this._schema = init.schema as SpaceSchema;
    this._metadata = init.metadata;
    this.colorScheme = init.colorScheme ?? 'light';
    applyColorScheme(this.colorScheme);

    window.addEventListener('message', this._onMessage);

    // Load initial data
    this.getInteractions().then((list) => { this.interactions = list; });
    this._call('getObjectIds').then((ids) => { this.objectIds = ids as string[]; });
    this.getConversations().then((list) => { this.conversations = list; });
    this.collections = Object.keys(this._schema);

    // Subscribe to channel updates → refresh interactions
    const onChannelUpdated = () => {
      this.getInteractions().then((list) => { this.interactions = list; });
    };
    this.on('channelUpdated', onChannelUpdated);
    this.#unsubscribers.push(() => this.off('channelUpdated', onChannelUpdated));

    // Subscribe to conversation updates → refresh conversations
    const onConversationUpdated = () => {
      this.getConversations().then((list) => { this.conversations = list; });
    };
    this.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => this.off('conversationUpdated', onConversationUpdated));

    // Subscribe to object events → refresh objectIds
    const refreshObjectIds = () => {
      this._call('getObjectIds').then((ids) => { this.objectIds = ids as string[]; });
    };
    this.on('objectCreated', refreshObjectIds);
    this.#unsubscribers.push(() => this.off('objectCreated', refreshObjectIds));
    this.on('objectDeleted', refreshObjectIds);
    this.#unsubscribers.push(() => this.off('objectDeleted', refreshObjectIds));

    // Subscribe to schema updates → refresh collections
    const onSchemaUpdated = () => {
      this.collections = Object.keys(this._schema);
    };
    this.on('schemaUpdated', onSchemaUpdated);
    this.#unsubscribers.push(() => this.off('schemaUpdated', onSchemaUpdated));

    // Full resets
    const onReset = () => {
      this.getInteractions().then((list) => { this.interactions = list; });
      this._call('getObjectIds').then((ids) => { this.objectIds = ids as string[]; });
      this.getConversations().then((list) => { this.conversations = list; });
      this.collections = Object.keys(this._schema);
    };
    this.on('reset', onReset);
    this.#unsubscribers.push(() => this.off('reset', onReset));
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
      if (msg.name === 'colorSchemeChanged') {
        const { colorScheme } = msg.data as { colorScheme: ColorScheme };
        this.colorScheme = colorScheme;
        applyColorScheme(colorScheme);
      } else if (msg.name === 'metadataUpdated') {
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
  // Object operations
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Interactions & system instruction
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * Get a reactive handle for a specific conversation within this channel.
   * Scopes AI and mutation operations to that conversation's interaction history.
   * Conversations are auto-created on first interaction.
   */
  conversation(conversationId: string): ReactiveConversationHandle {
    if (this.#closed) throw new Error('Cannot create reactive conversation: channel is closed');
    return new ReactiveConversationHandleImpl(this, conversationId);
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // AI
  // ---------------------------------------------------------------------------

  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._call('prompt', text, options) as Promise<{ message: string; objects: RoolObject[] }>;
  }

  // ---------------------------------------------------------------------------
  // Undo/redo
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Proxied fetch
  // ---------------------------------------------------------------------------

  /**
   * Fetch an external URL via the server proxy, bypassing CORS restrictions.
   * Requires editor role or above. Blocked for private/internal IP ranges (SSRF protection).
   */
  async fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown }
  ): Promise<Response> {
    const result = await this._call('fetch', url, init) as {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: ArrayBuffer;
    };
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: new Headers(result.headers),
    });
  }

  // ---------------------------------------------------------------------------
  // Reactive primitives
  // ---------------------------------------------------------------------------

  object(objectId: string): ReactiveObject {
    if (this.#closed) throw new Error('Cannot create reactive object: channel is closed');
    return new ReactiveObjectImpl(this, objectId);
  }

  watch(options: WatchOptions): ReactiveWatch {
    if (this.#closed) throw new Error('Cannot create reactive watch: channel is closed');
    return new ReactiveWatchImpl(this, options);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.#closed = true;
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    window.removeEventListener('message', this._onMessage);
    for (const { reject } of this._pending.values()) {
      reject(new Error('Channel destroyed'));
    }
    this._pending.clear();
    this._listeners.clear();
  }
}

export type ReactiveChannel = ReactiveChannelImpl;

// ---------------------------------------------------------------------------
// ReactiveConversationHandle
// ---------------------------------------------------------------------------

/**
 * A reactive conversation handle for the extension bridge.
 * Scopes AI and mutation operations to a specific conversation's
 * interaction history, while sharing the channel's bridge connection.
 *
 * Call `close()` when done to stop listening for updates.
 */
class ReactiveConversationHandleImpl {
  #channel: ReactiveChannelImpl;
  #conversationId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);

  constructor(channel: ReactiveChannelImpl, conversationId: string) {
    this.#channel = channel;
    this.#conversationId = conversationId;

    // Initial load
    this.getInteractions().then((list) => { this.interactions = list; });

    // Listen for updates to this conversation
    const onConversationUpdated = ({ conversationId: cid }: { conversationId: string }) => {
      if (cid === this.#conversationId) {
        this.getInteractions().then((list) => { this.interactions = list; });
      }
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    // Handle full resets
    const onReset = () => {
      this.getInteractions().then((list) => { this.interactions = list; });
    };
    channel.on('reset', onReset);
    this.#unsubscribers.push(() => channel.off('reset', onReset));
  }

  get conversationId(): string { return this.#conversationId; }

  // Conversation history

  async getInteractions(): Promise<Interaction[]> {
    return this.#channel._callScoped('getInteractions', [], this.#conversationId) as Promise<Interaction[]>;
  }

  async getTree(): Promise<Record<string, Interaction>> {
    return this.#channel._callScoped('getTree', [], this.#conversationId) as Promise<Record<string, Interaction>>;
  }

  async getActiveLeafId(): Promise<string | undefined> {
    return this.#channel._callScoped('getActiveLeafId', [], this.#conversationId) as Promise<string | undefined>;
  }

  async setActiveLeaf(interactionId: string): Promise<void> {
    await this.#channel._callScoped('setActiveLeaf', [interactionId], this.#conversationId);
  }

  async getSystemInstruction(): Promise<string | undefined> {
    return this.#channel._callScoped('getSystemInstruction', [], this.#conversationId) as Promise<string | undefined>;
  }

  async setSystemInstruction(instruction: string | null): Promise<void> {
    await this.#channel._callScoped('setSystemInstruction', [instruction], this.#conversationId);
  }

  async rename(name: string): Promise<void> {
    await this.#channel._callScoped('renameConversation', [name], this.#conversationId);
  }

  // Object operations

  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this.#channel._callScoped('findObjects', [options], this.#conversationId) as Promise<{ objects: RoolObject[]; message: string }>;
  }

  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this.#channel._callScoped('createObject', [options], this.#conversationId) as Promise<{ object: RoolObject; message: string }>;
  }

  async updateObject(objectId: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this.#channel._callScoped('updateObject', [objectId, options], this.#conversationId) as Promise<{ object: RoolObject; message: string }>;
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    await this.#channel._callScoped('deleteObjects', [objectIds], this.#conversationId);
  }

  // AI

  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this.#channel._callScoped('prompt', [text, options], this.#conversationId) as Promise<{ message: string; objects: RoolObject[] }>;
  }

  // Schema

  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this.#channel._callScoped('createCollection', [name, fields], this.#conversationId) as Promise<CollectionDef>;
  }

  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    return this.#channel._callScoped('alterCollection', [name, fields], this.#conversationId) as Promise<CollectionDef>;
  }

  async dropCollection(name: string): Promise<void> {
    await this.#channel._callScoped('dropCollection', [name], this.#conversationId);
  }

  // Metadata

  async setMetadata(key: string, value: unknown): Promise<void> {
    await this.#channel._callScoped('setMetadata', [key, value], this.#conversationId);
  }

  /**
   * Stop listening for updates and clean up.
   */
  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveConversationHandle = ReactiveConversationHandleImpl;

// ---------------------------------------------------------------------------
// initExtension
// ---------------------------------------------------------------------------

/**
 * Initialize the extension and return a reactive channel.
 *
 * Sends `rool:ready` to the host, waits for the handshake, and returns
 * a reactive channel with $state properties (interactions, objectIds)
 * and reactive primitives (object(), watch()).
 *
 * If the extension is opened directly (not in an iframe), redirects to the Rool
 * console with `?openExtension={extensionId}` so the user can install or navigate to it.
 *
 * @param timeout - How long to wait for the handshake (ms). Default: 10000.
 */
export function initExtension(timeout = 10000): Promise<ReactiveChannel> {
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
    return new Promise<ReactiveChannel>(() => {});
  }

  return new Promise<ReactiveChannel>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Extension handshake timed out — is this running inside a Rool host?'));
    }, timeout);

    function onMessage(event: MessageEvent): void {
      if (!isBridgeMessage(event.data) || event.data.type !== 'rool:init') return;

      clearTimeout(timer);
      window.removeEventListener('message', onMessage);

      resolve(new ReactiveChannelImpl(event.data as BridgeInit));
    }

    window.addEventListener('message', onMessage);

    // Signal to the host that we're ready
    window.parent.postMessage({ type: 'rool:ready' }, '*');
  });
}
