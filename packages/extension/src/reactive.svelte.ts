/**
 * Reactive Svelte wrapper around Channel (bridge client).
 *
 * Mirrors the @rool-dev/svelte ReactiveChannel API: same $state properties,
 * same methods, same reactive primitives (object(), watch()).
 * The underlying transport is the postMessage bridge, not the SDK.
 */

import { Channel, ConversationHandle } from './client.js';
import type {
  RoolObject,
  FieldDef,
  Interaction,
  ConversationInfo,
  PromptOptions,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
} from './types.js';

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
  #channel: Channel;
  #options: WatchOptions;
  #unsubscribers: (() => void)[] = [];
  #currentIds = new Set<string>();

  objects = $state<RoolObject[]>([]);
  loading = $state(true);

  constructor(channel: Channel, options: WatchOptions) {
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
  #channel: Channel;
  #objectId: string;
  #unsubscribers: (() => void)[] = [];

  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(channel: Channel, objectId: string) {
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
// ReactiveChannel
// ---------------------------------------------------------------------------

class ReactiveChannelImpl {
  #channel: Channel;
  #closed = false;

  // Reactive state
  interactions = $state<Interaction[]>([]);
  objectIds = $state<string[]>([]);
  collections = $state<string[]>([]);
  conversations = $state<ConversationInfo[]>([]);

  #unsubscribers: (() => void)[] = [];

  constructor(channel: Channel) {
    this.#channel = channel;

    // Load initial data
    channel.getInteractions().then((list) => { this.interactions = list; });
    channel.getObjectIds().then((ids) => { this.objectIds = ids; });
    channel.getConversations().then((list) => { this.conversations = list; });
    this.collections = Object.keys(channel.getSchema());

    // Subscribe to channel updates → refresh interactions
    const onChannelUpdated = () => {
      channel.getInteractions().then((list) => { this.interactions = list; });
    };
    channel.on('channelUpdated', onChannelUpdated);
    this.#unsubscribers.push(() => channel.off('channelUpdated', onChannelUpdated));

    // Subscribe to conversation updates → refresh conversations
    const onConversationUpdated = () => {
      channel.getConversations().then((list) => { this.conversations = list; });
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    // Subscribe to object events → refresh objectIds
    const refreshObjectIds = () => {
      channel.getObjectIds().then((ids) => { this.objectIds = ids; });
    };
    channel.on('objectCreated', refreshObjectIds);
    this.#unsubscribers.push(() => channel.off('objectCreated', refreshObjectIds));
    channel.on('objectDeleted', refreshObjectIds);
    this.#unsubscribers.push(() => channel.off('objectDeleted', refreshObjectIds));

    // Subscribe to schema updates → refresh collections
    const onSchemaUpdated = () => {
      this.collections = Object.keys(channel.getSchema());
    };
    channel.on('schemaUpdated', onSchemaUpdated);
    this.#unsubscribers.push(() => channel.off('schemaUpdated', onSchemaUpdated));

    // Full resets
    const onReset = () => {
      channel.getInteractions().then((list) => { this.interactions = list; });
      channel.getObjectIds().then((ids) => { this.objectIds = ids; });
      channel.getConversations().then((list) => { this.conversations = list; });
      this.collections = Object.keys(channel.getSchema());
    };
    channel.on('reset', onReset);
    this.#unsubscribers.push(() => channel.off('reset', onReset));
  }

  // Proxied properties
  get channelId() { return this.#channel.channelId; }
  get spaceId() { return this.#channel.spaceId; }
  get spaceName() { return this.#channel.spaceName; }
  get role() { return this.#channel.role; }
  get linkAccess() { return this.#channel.linkAccess; }
  get userId() { return this.#channel.userId; }
  get isReadOnly() { return this.#channel.isReadOnly; }

  // Object operations
  getObject(objectId: string) { return this.#channel.getObject(objectId); }
  stat(objectId: string) { return this.#channel.stat(objectId); }
  findObjects(options: FindObjectsOptions) { return this.#channel.findObjects(options); }
  getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }) { return this.#channel.getObjectIds(options); }
  createObject(options: CreateObjectOptions) { return this.#channel.createObject(options); }
  updateObject(objectId: string, options: UpdateObjectOptions) { return this.#channel.updateObject(objectId, options); }
  deleteObjects(objectIds: string[]) { return this.#channel.deleteObjects(objectIds); }

  // AI
  prompt(text: string, options?: PromptOptions) { return this.#channel.prompt(text, options); }

  // Undo/redo
  checkpoint(label?: string) { return this.#channel.checkpoint(label); }
  canUndo() { return this.#channel.canUndo(); }
  canRedo() { return this.#channel.canRedo(); }
  undo() { return this.#channel.undo(); }
  redo() { return this.#channel.redo(); }
  clearHistory() { return this.#channel.clearHistory(); }

  // Metadata
  setMetadata(key: string, value: unknown) { return this.#channel.setMetadata(key, value); }
  getMetadata(key: string) { return this.#channel.getMetadata(key); }
  getAllMetadata() { return this.#channel.getAllMetadata(); }

  // History
  getInteractions() { return this.#channel.getInteractions(); }
  getTree() { return this.#channel.getTree(); }
  getActiveLeafId() { return this.#channel.getActiveLeafId(); }
  setActiveLeaf(interactionId: string) { return this.#channel.setActiveLeaf(interactionId); }
  getSystemInstruction() { return this.#channel.getSystemInstruction(); }
  setSystemInstruction(instruction: string | null) { return this.#channel.setSystemInstruction(instruction); }
  getConversations() { return this.#channel.getConversations(); }
  deleteConversation(conversationId: string) { return this.#channel.deleteConversation(conversationId); }
  renameConversation(name: string) { return this.#channel.renameConversation(name); }

  // Schema
  getSchema() { return this.#channel.getSchema(); }
  createCollection(name: string, fields: FieldDef[]) { return this.#channel.createCollection(name, fields); }
  alterCollection(name: string, fields: FieldDef[]) { return this.#channel.alterCollection(name, fields); }
  dropCollection(name: string) { return this.#channel.dropCollection(name); }

  // Conversations
  conversation(conversationId: string): ReactiveConversationHandle {
    if (this.#closed) throw new Error('Cannot create reactive conversation: channel is closed');
    return new ReactiveConversationHandleImpl(this.#channel, conversationId);
  }

  // Events
  on(...args: Parameters<Channel['on']>) { return this.#channel.on(...args); }
  off(...args: Parameters<Channel['off']>) { return this.#channel.off(...args); }

  // Reactive primitives

  object(objectId: string): ReactiveObject {
    if (this.#closed) throw new Error('Cannot create reactive object: channel is closed');
    return new ReactiveObjectImpl(this.#channel, objectId);
  }

  watch(options: WatchOptions): ReactiveWatch {
    if (this.#closed) throw new Error('Cannot create reactive watch: channel is closed');
    return new ReactiveWatchImpl(this.#channel, options);
  }

  // Cleanup

  destroy(): void {
    this.#closed = true;
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    this.#channel.destroy();
  }
}

export type ReactiveChannel = ReactiveChannelImpl;

// ---------------------------------------------------------------------------
// ReactiveConversationHandle
// ---------------------------------------------------------------------------

/**
 * A reactive conversation handle for the extension bridge.
 * Wraps ConversationHandle with $state interactions that auto-update
 * when the conversation changes via SSE events.
 *
 * Call `close()` when done to stop listening for updates.
 */
class ReactiveConversationHandleImpl {
  #handle: ConversationHandle;
  #conversationId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);

  constructor(channel: Channel, conversationId: string) {
    this.#conversationId = conversationId;
    this.#handle = channel.conversation(conversationId);

    // Initial load
    this.#handle.getInteractions().then((list) => { this.interactions = list; });

    // Listen for updates to this conversation
    const onConversationUpdated = ({ conversationId: cid }: { conversationId: string }) => {
      if (cid === this.#conversationId) {
        this.#handle.getInteractions().then((list) => { this.interactions = list; });
      }
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    // Handle full resets
    const onReset = () => {
      this.#handle.getInteractions().then((list) => { this.interactions = list; });
    };
    channel.on('reset', onReset);
    this.#unsubscribers.push(() => channel.off('reset', onReset));
  }

  get conversationId(): string { return this.#conversationId; }

  // Conversation history
  getInteractions() { return this.#handle.getInteractions(); }
  getTree() { return this.#handle.getTree(); }
  getActiveLeafId() { return this.#handle.getActiveLeafId(); }
  setActiveLeaf(interactionId: string) { return this.#handle.setActiveLeaf(interactionId); }
  getSystemInstruction() { return this.#handle.getSystemInstruction(); }
  setSystemInstruction(instruction: string | null) { return this.#handle.setSystemInstruction(instruction); }
  rename(name: string) { return this.#handle.rename(name); }

  // Object operations
  findObjects(options: FindObjectsOptions) { return this.#handle.findObjects(options); }
  createObject(options: CreateObjectOptions) { return this.#handle.createObject(options); }
  updateObject(objectId: string, options: UpdateObjectOptions) { return this.#handle.updateObject(objectId, options); }
  deleteObjects(objectIds: string[]) { return this.#handle.deleteObjects(objectIds); }

  // AI
  prompt(text: string, options?: PromptOptions) { return this.#handle.prompt(text, options); }

  // Schema
  createCollection(name: string, fields: FieldDef[]) { return this.#handle.createCollection(name, fields); }
  alterCollection(name: string, fields: FieldDef[]) { return this.#handle.alterCollection(name, fields); }
  dropCollection(name: string) { return this.#handle.dropCollection(name); }

  // Metadata
  setMetadata(key: string, value: unknown) { return this.#handle.setMetadata(key, value); }

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
// initExtension (reactive version)
// ---------------------------------------------------------------------------

import { initExtension as initBridge } from './client.js';

/**
 * Initialize the extension and return a reactive channel.
 *
 * Sends `rool:ready` to the host, waits for the handshake, and returns
 * a reactive channel with $state properties (interactions, objectIds)
 * and reactive primitives (object(), watch()).
 */
export async function initExtension(timeout?: number): Promise<ReactiveChannel> {
  const bridge = await initBridge(timeout);
  return new ReactiveChannelImpl(bridge);
}
