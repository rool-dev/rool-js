import type {
  RoolChannel,
  RoolSpace,
  Interaction,
  RoolObject,
  FindObjectsOptions,
  ChannelInfo,
  ConversationInfo,
  ConversationHandle,
  ConversationUpdatedEvent,
  ObjectCreatedEvent,
  ObjectUpdatedEvent,
  ObjectDeletedEvent,
  ObjectMovedEvent,
} from '@rool-dev/sdk';

/**
 * Options for creating a reactive watch.
 * Same as FindObjectsOptions for reactive updates.
 */
export interface WatchOptions {
  /** Field requirements for exact matching */
  where?: Record<string, unknown>;
  /** Filter by collection name. */
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
  #currentLocations = new Set<string>();

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

    const onObjectCreated = ({ object }: ObjectCreatedEvent) => {
      if (this.#matches(object)) {
        this.refresh();
      }
    };
    this.#channel.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#channel.off('objectCreated', onObjectCreated));

    const onObjectUpdated = ({ location, object }: ObjectUpdatedEvent) => {
      const wasInCollection = this.#currentLocations.has(location);
      const nowMatches = this.#matches(object);

      if (wasInCollection && nowMatches) {
        // Update in place (merge to preserve fields from partial optimistic updates)
        const index = this.objects.findIndex((o) => o.location === location);
        if (index !== -1) {
          this.objects[index] = {
            ...this.objects[index],
            ...object,
            body: { ...this.objects[index].body, ...object.body },
          };
        }
      } else if (wasInCollection && !nowMatches) {
        // Check if the mismatch is due to missing keys in body (partial optimistic update)
        const where = this.#options.where;
        const isPartialUpdate = where && Object.keys(where).some((key) => !(key in object.body));
        if (isPartialUpdate) {
          const index = this.objects.findIndex((o) => o.location === location);
          if (index !== -1) {
            this.objects[index] = {
              ...this.objects[index],
              ...object,
              body: { ...this.objects[index].body, ...object.body },
            };
          }
        } else {
          // Genuine mismatch — remove from collection
          this.objects = this.objects.filter((o) => o.location !== location);
          this.#currentLocations.delete(location);
        }
      } else if (!wasInCollection && nowMatches) {
        // Add to collection (re-fetch to respect limit/order)
        this.refresh();
      }
    };
    this.#channel.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#channel.off('objectUpdated', onObjectUpdated));

    const onObjectDeleted = ({ location }: ObjectDeletedEvent) => {
      if (this.#currentLocations.has(location)) {
        this.objects = this.objects.filter((o) => o.location !== location);
        this.#currentLocations.delete(location);
      }
    };
    this.#channel.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#channel.off('objectDeleted', onObjectDeleted));

    const onObjectMoved = ({ from, object }: ObjectMovedEvent) => {
      const wasInCollection = this.#currentLocations.has(from);
      const nowMatches = this.#matches(object);
      if (wasInCollection || nowMatches) {
        this.refresh();
      }
    };
    this.#channel.on('objectMoved', onObjectMoved);
    this.#unsubscribers.push(() => this.#channel.off('objectMoved', onObjectMoved));

    const onReset = () => this.refresh();
    this.#channel.on('reset', onReset);
    this.#unsubscribers.push(() => this.#channel.off('reset', onReset));
  }

  /**
   * Check if an object matches the filter (collection + where on body).
   */
  #matches(object: RoolObject): boolean {
    if (this.#options.collection && object.collection !== this.#options.collection) return false;

    const where = this.#options.where;
    if (!where) return true;

    for (const [key, value] of Object.entries(where)) {
      if (object.body[key] !== value) return false;
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
      };
      const { objects } = await this.#channel.findObjects(findOptions);
      this.objects = objects;
      this.#currentLocations = new Set(objects.map((o) => o.location));
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

/**
 * A reactive single object that auto-updates when the object changes.
 */
class ReactiveObjectImpl {
  #channel: RoolChannel;
  #location: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(channel: RoolChannel, location: string) {
    this.#channel = channel;
    this.#location = location;
    this.#setup();
  }

  #setup() {
    this.refresh();

    const onObjectUpdated = ({ location, object }: ObjectUpdatedEvent) => {
      if (location === this.#location) {
        this.data = object;
      }
    };
    this.#channel.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#channel.off('objectUpdated', onObjectUpdated));

    const onObjectCreated = ({ location, object }: ObjectCreatedEvent) => {
      if (location === this.#location) {
        this.data = object;
      }
    };
    this.#channel.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#channel.off('objectCreated', onObjectCreated));

    const onObjectDeleted = ({ location }: ObjectDeletedEvent) => {
      if (location === this.#location) {
        this.data = undefined;
      }
    };
    this.#channel.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#channel.off('objectDeleted', onObjectDeleted));

    const onObjectMoved = ({ from, to, object }: ObjectMovedEvent) => {
      if (from === this.#location) {
        // Object moved away from this location; data is gone.
        this.data = undefined;
      } else if (to === this.#location) {
        this.data = object;
      }
    };
    this.#channel.on('objectMoved', onObjectMoved);
    this.#unsubscribers.push(() => this.#channel.off('objectMoved', onObjectMoved));

    const onReset = () => this.refresh();
    this.#channel.on('reset', onReset);
    this.#unsubscribers.push(() => this.#channel.off('reset', onReset));
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.data = await this.#channel.getObject(this.#location);
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
// ReactiveConversationHandle
// ---------------------------------------------------------------------------

class ReactiveConversationHandleImpl {
  #handle: ConversationHandle;
  #conversationId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);

  constructor(channel: RoolChannel, conversationId: string) {
    this.#conversationId = conversationId;
    this.#handle = channel.conversation(conversationId);

    this.interactions = this.#handle.getInteractions();

    const onConversationUpdated = (event: ConversationUpdatedEvent) => {
      if (event.conversationId === this.#conversationId) {
        this.interactions = this.#handle.getInteractions();
      }
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    const onReset = () => {
      this.interactions = this.#handle.getInteractions();
    };
    channel.on('reset', onReset);
    this.#unsubscribers.push(() => channel.off('reset', onReset));
  }

  get conversationId(): string { return this.#conversationId; }

  // Conversation history
  getInteractions() { return this.#handle.getInteractions(); }
  getTree() { return this.#handle.getTree(); }
  get activeLeafId() { return this.#handle.activeLeafId; }
  setActiveLeaf(interactionId: string) { this.#handle.setActiveLeaf(interactionId); }
  getSystemInstruction() { return this.#handle.getSystemInstruction(); }
  setSystemInstruction(...args: Parameters<ConversationHandle['setSystemInstruction']>) { return this.#handle.setSystemInstruction(...args); }
  rename(...args: Parameters<ConversationHandle['rename']>) { return this.#handle.rename(...args); }

  // Object operations
  findObjects(...args: Parameters<ConversationHandle['findObjects']>) { return this.#handle.findObjects(...args); }
  createObject(...args: Parameters<ConversationHandle['createObject']>) { return this.#handle.createObject(...args); }
  updateObject(...args: Parameters<ConversationHandle['updateObject']>) { return this.#handle.updateObject(...args); }
  moveObject(...args: Parameters<ConversationHandle['moveObject']>) { return this.#handle.moveObject(...args); }
  deleteObjects(...args: Parameters<ConversationHandle['deleteObjects']>) { return this.#handle.deleteObjects(...args); }

  // AI
  prompt(...args: Parameters<ConversationHandle['prompt']>) { return this.#handle.prompt(...args); }

  // Schema
  createCollection(...args: Parameters<ConversationHandle['createCollection']>) { return this.#handle.createCollection(...args); }
  alterCollection(...args: Parameters<ConversationHandle['alterCollection']>) { return this.#handle.alterCollection(...args); }
  dropCollection(...args: Parameters<ConversationHandle['dropCollection']>) { return this.#handle.dropCollection(...args); }

  // Metadata
  setMetadata(...args: Parameters<ConversationHandle['setMetadata']>) { return this.#handle.setMetadata(...args); }

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
  objectLocations = $state<string[]>([]);
  collections = $state<string[]>([]);
  conversations = $state<ConversationInfo[]>([]);

  constructor(channel: RoolChannel) {
    this.#channel = channel;
    this.interactions = channel.getInteractions();
    this.objectLocations = channel.getObjectLocations();
    this.collections = Object.keys(channel.getSchema());
    this.conversations = channel.getConversations();

    const onChannelUpdated = () => {
      this.interactions = channel.getInteractions();
      this.conversations = channel.getConversations();
    };
    channel.on('channelUpdated', onChannelUpdated);
    this.#unsubscribers.push(() => channel.off('channelUpdated', onChannelUpdated));

    const onConversationUpdated = () => {
      this.conversations = channel.getConversations();
    };
    channel.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => channel.off('conversationUpdated', onConversationUpdated));

    const refreshObjectLocations = () => {
      this.objectLocations = channel.getObjectLocations();
    };
    channel.on('objectCreated', refreshObjectLocations);
    this.#unsubscribers.push(() => channel.off('objectCreated', refreshObjectLocations));
    channel.on('objectDeleted', refreshObjectLocations);
    this.#unsubscribers.push(() => channel.off('objectDeleted', refreshObjectLocations));
    channel.on('objectMoved', refreshObjectLocations);
    this.#unsubscribers.push(() => channel.off('objectMoved', refreshObjectLocations));

    const onSchemaUpdated = () => {
      this.collections = Object.keys(channel.getSchema());
    };
    channel.on('schemaUpdated', onSchemaUpdated);
    this.#unsubscribers.push(() => channel.off('schemaUpdated', onSchemaUpdated));

    const onReset = () => {
      this.interactions = channel.getInteractions();
      this.objectLocations = channel.getObjectLocations();
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
  get extensionUrl() { return this.#channel.extensionUrl; }
  get extensionId() { return this.#channel.extensionId; }
  get manifest() { return this.#channel.manifest; }

  get isClosed() { return this.#closed; }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    this.#channel.close();
  }

  // Object operations
  getObject(...args: Parameters<RoolChannel['getObject']>) { return this.#channel.getObject(...args); }
  stat(...args: Parameters<RoolChannel['stat']>) { return this.#channel.stat(...args); }
  findObjects(...args: Parameters<RoolChannel['findObjects']>) { return this.#channel.findObjects(...args); }
  getObjectLocations(...args: Parameters<RoolChannel['getObjectLocations']>) { return this.#channel.getObjectLocations(...args); }
  createObject(...args: Parameters<RoolChannel['createObject']>) { return this.#channel.createObject(...args); }
  updateObject(...args: Parameters<RoolChannel['updateObject']>) { return this.#channel.updateObject(...args); }
  moveObject(...args: Parameters<RoolChannel['moveObject']>) { return this.#channel.moveObject(...args); }
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
  getTree() { return this.#channel.getTree(); }
  get activeLeafId() { return this.#channel.activeLeafId; }
  setActiveLeaf(interactionId: string) { this.#channel.setActiveLeaf(interactionId); }
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

  // Proxied fetch
  fetch(...args: Parameters<RoolChannel['fetch']>) { return this.#channel.fetch(...args); }

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
   * Create a reactive object that auto-updates when the object at this location changes.
   */
  object(location: string): ReactiveObject {
    if (this.#closed) throw new Error('Cannot create reactive object: channel is closed');
    return new ReactiveObjectImpl(this.#channel, location);
  }

  /**
   * Create a reactive watch that auto-updates when matching objects change.
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
  #space: RoolSpace | null = null;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  list = $state<ChannelInfo[]>([]);
  loading = $state(true);

  constructor(spaceOrPromise: RoolSpace | Promise<RoolSpace>) {
    if (spaceOrPromise instanceof Promise) {
      spaceOrPromise.then((space) => this.#attach(space)).catch(() => {
        this.loading = false;
      });
    } else {
      this.#attach(spaceOrPromise);
    }
  }

  #attach(space: RoolSpace) {
    this.#space = space;
    this.list = space.channels;
    this.loading = false;

    const onChannelCreated = (channel: ChannelInfo) => {
      this.list = [...this.list, channel];
    };
    space.on('channelCreated', onChannelCreated);
    this.#unsubscribers.push(() => space.off('channelCreated', onChannelCreated));

    const onChannelUpdated = (channel: ChannelInfo) => {
      this.list = this.list.map(ch =>
        ch.id === channel.id ? channel : ch
      );
    };
    space.on('channelUpdated', onChannelUpdated);
    this.#unsubscribers.push(() => space.off('channelUpdated', onChannelUpdated));

    const onChannelDeleted = (channelId: string) => {
      this.list = this.list.filter(ch => ch.id !== channelId);
    };
    space.on('channelDeleted', onChannelDeleted);
    this.#unsubscribers.push(() => space.off('channelDeleted', onChannelDeleted));
  }

  async refresh(): Promise<void> {
    if (!this.#space) return;
    this.loading = true;
    try {
      await this.#space.refresh();
      this.list = this.#space.channels;
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export function createChannelList(spaceOrPromise: RoolSpace | Promise<RoolSpace>): ReactiveChannelList {
  return new ReactiveChannelListImpl(spaceOrPromise);
}

export type ReactiveChannelList = ReactiveChannelListImpl;
