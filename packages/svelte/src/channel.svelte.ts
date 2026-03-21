import type { RoolChannel, RoolClient, Interaction, RoolObject, FindObjectsOptions, ChannelInfo, ConversationInfo, ConversationHandle, ConversationUpdatedEvent } from '@rool-dev/sdk';

/**
 * Options for creating a reactive watch.
 * Same as FindObjectsOptions but without `prompt` (AI queries are too slow for reactive updates).
 */
export interface WatchOptions {
  /** Field requirements for exact matching */
  where?: Record<string, unknown>;
  /** Filter by collection name. Only returns objects whose shape matches the named collection. */
  collection?: string;
  /** Maximum number of objects */
  limit?: number;
  /** Sort order by modifiedAt: 'asc' or 'desc' (default: 'desc') */
  order?: 'asc' | 'desc';
}


/**
 * A reactive watch of objects that auto-updates when matching objects change.
 */
class ReactiveWatchImpl {
  #channel: RoolChannel;
  #options: WatchOptions;
  #unsubscribers: (() => void)[] = [];
  #currentIds = new Set<string>();

  // Reactive state
  objects = $state<RoolObject[]>([]);
  loading = $state(true);

  constructor(channel: RoolChannel, options: WatchOptions) {
    this.#channel = channel;
    this.#options = options;
    this.#setup();
  }

  #setup() {
    // Initial fetch
    this.refresh();

    // Subscribe to object events
    const onObjectCreated = ({ object }: { object: RoolObject }) => {
      if (this.#matches(object)) {
        this.refresh();
      }
    };
    this.#channel.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#channel.off('objectCreated', onObjectCreated));

    const onObjectUpdated = ({ objectId, object }: { objectId: string; object: RoolObject }) => {
      const wasInCollection = this.#currentIds.has(objectId);
      const nowMatches = this.#matches(object);

      if (wasInCollection && nowMatches) {
        // Update in place (merge to preserve fields from partial optimistic updates)
        const index = this.objects.findIndex((o) => o.id === objectId);
        if (index !== -1) {
          this.objects[index] = { ...this.objects[index], ...object };
        }
      } else if (wasInCollection && !nowMatches) {
        // Check if the mismatch is due to missing keys (partial optimistic update)
        // vs. genuinely changed values that no longer satisfy the filter.
        const where = this.#options.where;
        const isPartialUpdate = where && Object.keys(where).some((key) => !(key in object));
        if (isPartialUpdate) {
          // Partial update — merge onto existing object instead of removing
          const index = this.objects.findIndex((o) => o.id === objectId);
          if (index !== -1) {
            this.objects[index] = { ...this.objects[index], ...object };
          }
        } else {
          // Genuine mismatch — remove from collection
          this.objects = this.objects.filter((o) => o.id !== objectId);
          this.#currentIds.delete(objectId);
        }
      } else if (!wasInCollection && nowMatches) {
        // Add to collection (re-fetch to respect limit/order)
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

    // Handle full resets
    const onReset = () => this.refresh();
    this.#channel.on('reset', onReset);
    this.#unsubscribers.push(() => this.#channel.off('reset', onReset));
  }

  /**
   * Check if an object matches the `where` filter.
   */
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

  /**
   * Re-fetch the watched objects from the channel.
   */
  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const findOptions: FindObjectsOptions = {
        where: this.#options.where,
        collection: this.#options.collection,
        limit: this.#options.limit,
        order: this.#options.order,
        ephemeral: true, // Don't pollute interaction history
      };
      const { objects } = await this.#channel.findObjects(findOptions);
      this.objects = objects;
      this.#currentIds = new Set(objects.map((o) => o.id));
    } finally {
      this.loading = false;
    }
  }

  /**
   * Stop listening for updates and clean up.
   */
  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveWatch = ReactiveWatchImpl;

/**
 * A reactive single object that auto-updates when the object changes.
 */
class ReactiveObjectImpl {
  #channel: RoolChannel;
  #objectId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(channel: RoolChannel, objectId: string) {
    this.#channel = channel;
    this.#objectId = objectId;
    this.#setup();
  }

  #setup() {
    // Initial fetch
    this.refresh();

    // Listen for updates to this specific object
    const onObjectUpdated = ({ objectId, object }: { objectId: string; object: RoolObject }) => {
      if (objectId === this.#objectId) {
        this.data = object;
      }
    };
    this.#channel.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#channel.off('objectUpdated', onObjectUpdated));

    // Listen for creation (in case object didn't exist initially)
    const onObjectCreated = ({ object }: { object: RoolObject }) => {
      if (object.id === this.#objectId) {
        this.data = object;
      }
    };
    this.#channel.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#channel.off('objectCreated', onObjectCreated));

    // Listen for deletion
    const onObjectDeleted = ({ objectId }: { objectId: string }) => {
      if (objectId === this.#objectId) {
        this.data = undefined;
      }
    };
    this.#channel.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#channel.off('objectDeleted', onObjectDeleted));

    // Handle full resets
    const onReset = () => this.refresh();
    this.#channel.on('reset', onReset);
    this.#unsubscribers.push(() => this.#channel.off('reset', onReset));
  }

  /**
   * Re-fetch the object from the channel.
   */
  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.data = await this.#channel.getObject(this.#objectId);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Stop listening for updates and clean up.
   */
  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveObject = ReactiveObjectImpl;

// ---------------------------------------------------------------------------
// ReactiveConversationHandle
// ---------------------------------------------------------------------------

/**
 * A reactive conversation handle that auto-updates interactions when the
 * conversation changes. Wraps the SDK's ConversationHandle with $state.
 *
 * Call `close()` when done to stop listening for updates.
 */
class ReactiveConversationHandleImpl {
  #handle: ConversationHandle;
  #conversationId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);

  constructor(channel: RoolChannel, conversationId: string) {
    this.#conversationId = conversationId;
    this.#handle = channel.conversation(conversationId);

    // Initial load
    this.interactions = this.#handle.getInteractions();

    // Listen for updates to this conversation
    const onConversationUpdated = (event: ConversationUpdatedEvent) => {
      if (event.conversationId === this.#conversationId) {
        this.interactions = this.#handle.getInteractions();
      }
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    // Handle full resets
    const onReset = () => {
      this.interactions = this.#handle.getInteractions();
    };
    channel.on('reset', onReset);
    this.#unsubscribers.push(() => channel.off('reset', onReset));
  }

  get conversationId(): string { return this.#conversationId; }

  // Conversation history
  getInteractions() { return this.#handle.getInteractions(); }
  getSystemInstruction() { return this.#handle.getSystemInstruction(); }
  setSystemInstruction(...args: Parameters<ConversationHandle['setSystemInstruction']>) { return this.#handle.setSystemInstruction(...args); }
  rename(...args: Parameters<ConversationHandle['rename']>) { return this.#handle.rename(...args); }

  // Object operations
  findObjects(...args: Parameters<ConversationHandle['findObjects']>) { return this.#handle.findObjects(...args); }
  createObject(...args: Parameters<ConversationHandle['createObject']>) { return this.#handle.createObject(...args); }
  updateObject(...args: Parameters<ConversationHandle['updateObject']>) { return this.#handle.updateObject(...args); }
  deleteObjects(...args: Parameters<ConversationHandle['deleteObjects']>) { return this.#handle.deleteObjects(...args); }

  // AI
  prompt(...args: Parameters<ConversationHandle['prompt']>) { return this.#handle.prompt(...args); }

  // Schema
  createCollection(...args: Parameters<ConversationHandle['createCollection']>) { return this.#handle.createCollection(...args); }
  alterCollection(...args: Parameters<ConversationHandle['alterCollection']>) { return this.#handle.alterCollection(...args); }
  dropCollection(...args: Parameters<ConversationHandle['dropCollection']>) { return this.#handle.dropCollection(...args); }

  // Metadata
  setMetadata(...args: Parameters<ConversationHandle['setMetadata']>) { return this.#handle.setMetadata(...args); }

  /**
   * Stop listening for updates and clean up.
   */
  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveConversationHandle = ReactiveConversationHandleImpl;

/**
 * Minimal wrapper that adds reactive `interactions` to RoolChannel.
 * All other properties and methods are proxied to the underlying channel.
 */
class ReactiveChannelImpl {
  #channel: RoolChannel;
  #unsubscribers: (() => void)[] = [];
  #closed = false;

  // Reactive state
  interactions = $state<Interaction[]>([]);
  objectIds = $state<string[]>([]);
  collections = $state<string[]>([]);
  conversations = $state<ConversationInfo[]>([]);

  constructor(channel: RoolChannel) {
    this.#channel = channel;
    this.interactions = channel.getInteractions();
    this.objectIds = channel.getObjectIds();
    this.collections = Object.keys(channel.getSchema());
    this.conversations = channel.getConversations();

    // Subscribe to channel updates → refresh interactions
    const onChannelUpdated = () => {
      this.interactions = channel.getInteractions();
    };
    channel.on('channelUpdated', onChannelUpdated);
    this.#unsubscribers.push(() => channel.off('channelUpdated', onChannelUpdated));

    // Subscribe to conversation updates → refresh conversations
    const onConversationUpdated = () => {
      this.conversations = channel.getConversations();
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    // Subscribe to object events for objectIds
    const refreshObjectIds = () => {
      this.objectIds = channel.getObjectIds();
    };
    channel.on('objectCreated', refreshObjectIds);
    this.#unsubscribers.push(() => channel.off('objectCreated', refreshObjectIds));
    channel.on('objectDeleted', refreshObjectIds);
    this.#unsubscribers.push(() => channel.off('objectDeleted', refreshObjectIds));

    // Subscribe to schema updates for collections
    const onSchemaUpdated = () => {
      this.collections = Object.keys(channel.getSchema());
    };
    channel.on('schemaUpdated', onSchemaUpdated);
    this.#unsubscribers.push(() => channel.off('schemaUpdated', onSchemaUpdated));

    const onReset = () => {
      this.interactions = channel.getInteractions();
      this.objectIds = channel.getObjectIds();
      this.collections = Object.keys(channel.getSchema());
      this.conversations = channel.getConversations();
    };
    channel.on('reset', onReset);
    this.#unsubscribers.push(() => channel.off('reset', onReset));
  }

  // Proxy read-only properties
  get id() { return this.#channel.id; }
  get name() { return this.#channel.name; }
  get role() { return this.#channel.role; }
  get userId() { return this.#channel.userId; }
  get channelId() { return this.#channel.channelId; }
  get channelName() { return this.#channel.channelName; }
  get isReadOnly() { return this.#channel.isReadOnly; }
  get linkAccess() { return this.#channel.linkAccess; }
  get appUrl() { return this.#channel.appUrl; }

  // Proxy all methods
  close() {
    this.#closed = true;
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    this.#channel.close();
  }

  // Object operations
  getObject(...args: Parameters<RoolChannel['getObject']>) { return this.#channel.getObject(...args); }
  stat(...args: Parameters<RoolChannel['stat']>) { return this.#channel.stat(...args); }
  findObjects(...args: Parameters<RoolChannel['findObjects']>) { return this.#channel.findObjects(...args); }
  getObjectIds(...args: Parameters<RoolChannel['getObjectIds']>) { return this.#channel.getObjectIds(...args); }
  createObject(...args: Parameters<RoolChannel['createObject']>) { return this.#channel.createObject(...args); }
  updateObject(...args: Parameters<RoolChannel['updateObject']>) { return this.#channel.updateObject(...args); }
  deleteObjects(...args: Parameters<RoolChannel['deleteObjects']>) { return this.#channel.deleteObjects(...args); }

  // AI
  prompt(...args: Parameters<RoolChannel['prompt']>) { return this.#channel.prompt(...args); }

  // Undo/redo
  checkpoint(...args: Parameters<RoolChannel['checkpoint']>) { return this.#channel.checkpoint(...args); }
  canUndo() { return this.#channel.canUndo(); }
  canRedo() { return this.#channel.canRedo(); }
  undo() { return this.#channel.undo(); }
  redo() { return this.#channel.redo(); }
  clearHistory() { return this.#channel.clearHistory(); }

  // Metadata
  setMetadata(...args: Parameters<RoolChannel['setMetadata']>) { return this.#channel.setMetadata(...args); }
  getMetadata(...args: Parameters<RoolChannel['getMetadata']>) { return this.#channel.getMetadata(...args); }
  getAllMetadata() { return this.#channel.getAllMetadata(); }

  // Channel history
  getInteractions() { return this.#channel.getInteractions(); }
  getSystemInstruction() { return this.#channel.getSystemInstruction(); }
  setSystemInstruction(...args: Parameters<RoolChannel['setSystemInstruction']>) { return this.#channel.setSystemInstruction(...args); }
  getConversations() { return this.#channel.getConversations(); }
  deleteConversation(...args: Parameters<RoolChannel['deleteConversation']>) { return this.#channel.deleteConversation(...args); }
  renameConversation(...args: Parameters<RoolChannel['renameConversation']>) { return this.#channel.renameConversation(...args); }

  // Schema
  getSchema() { return this.#channel.getSchema(); }
  createCollection(...args: Parameters<RoolChannel['createCollection']>) { return this.#channel.createCollection(...args); }
  alterCollection(...args: Parameters<RoolChannel['alterCollection']>) { return this.#channel.alterCollection(...args); }
  dropCollection(...args: Parameters<RoolChannel['dropCollection']>) { return this.#channel.dropCollection(...args); }

  // Media
  uploadMedia(...args: Parameters<RoolChannel['uploadMedia']>) { return this.#channel.uploadMedia(...args); }
  fetchMedia(...args: Parameters<RoolChannel['fetchMedia']>) { return this.#channel.fetchMedia(...args); }
  deleteMedia(...args: Parameters<RoolChannel['deleteMedia']>) { return this.#channel.deleteMedia(...args); }
  listMedia() { return this.#channel.listMedia(); }

  // Channel admin
  rename(...args: Parameters<RoolChannel['rename']>) { return this.#channel.rename(...args); }

  // Conversations
  conversation(conversationId: string): ReactiveConversationHandle {
    if (this.#closed) throw new Error('Cannot create reactive conversation: channel is closed');
    return new ReactiveConversationHandleImpl(this.#channel, conversationId);
  }

  // Events
  on(...args: Parameters<RoolChannel['on']>) { return this.#channel.on(...args); }
  off(...args: Parameters<RoolChannel['off']>) { return this.#channel.off(...args); }

  // Reactive primitives

  /**
   * Create a reactive object that auto-updates when the object changes.
   * Throws if the channel has been closed.
   */
  object(objectId: string): ReactiveObject {
    if (this.#closed) throw new Error('Cannot create reactive object: channel is closed');
    return new ReactiveObjectImpl(this.#channel, objectId);
  }

  /**
   * Create a reactive watch that auto-updates when matching objects change.
   * Throws if the channel has been closed.
   */
  watch(options: WatchOptions): ReactiveWatch {
    if (this.#closed) throw new Error('Cannot create reactive watch: channel is closed');
    return new ReactiveWatchImpl(this.#channel, options);
  }

}

export function wrapChannel(channel: RoolChannel): ReactiveChannel {
  return new ReactiveChannelImpl(channel);
}

export type ReactiveChannel = ReactiveChannelImpl;

/**
 * A reactive list of channels for a space that auto-updates via SSE events.
 */
class ReactiveChannelListImpl {
  #client: RoolClient;
  #spaceId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  list = $state<ChannelInfo[]>([]);
  loading = $state(true);

  constructor(client: RoolClient, spaceId: string) {
    this.#client = client;
    this.#spaceId = spaceId;
    this.#setup();
  }

  #setup() {
    // Initial fetch
    this.refresh();

    // Listen for channel lifecycle events
    const onChannelCreated = (spaceId: string, channel: ChannelInfo) => {
      if (spaceId !== this.#spaceId) return;
      this.list = [...this.list, channel];
    };
    this.#client.on('channelCreated', onChannelCreated);
    this.#unsubscribers.push(() => this.#client.off('channelCreated', onChannelCreated));

    const onChannelRenamed = (spaceId: string, channelId: string, newName: string) => {
      if (spaceId !== this.#spaceId) return;
      this.list = this.list.map(ch =>
        ch.id === channelId ? { ...ch, name: newName } : ch
      );
    };
    this.#client.on('channelRenamed', onChannelRenamed);
    this.#unsubscribers.push(() => this.#client.off('channelRenamed', onChannelRenamed));

    const onChannelDeleted = (spaceId: string, channelId: string) => {
      if (spaceId !== this.#spaceId) return;
      this.list = this.list.filter(ch => ch.id !== channelId);
    };
    this.#client.on('channelDeleted', onChannelDeleted);
    this.#unsubscribers.push(() => this.#client.off('channelDeleted', onChannelDeleted));
  }

  /**
   * Re-fetch the channel list from the server.
   * Opens a lightweight space handle to get the channel list.
   */
  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const space = await this.#client.openSpace(this.#spaceId);
      this.list = space.getChannels();
    } finally {
      this.loading = false;
    }
  }

  /**
   * Stop listening for updates and clean up.
   */
  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export function createChannelList(client: RoolClient, spaceId: string): ReactiveChannelList {
  return new ReactiveChannelListImpl(client, spaceId);
}

export type ReactiveChannelList = ReactiveChannelListImpl;
