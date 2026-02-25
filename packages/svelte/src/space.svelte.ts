import type { RoolSpace, Interaction, RoolObject, FindObjectsOptions, ConversationInfo } from '@rool-dev/sdk';

/**
 * Options for creating a reactive collection.
 * Same as FindObjectsOptions but without `prompt` (AI queries are too slow for reactive updates).
 */
export interface CollectionOptions {
  /** Field requirements for exact matching */
  where?: Record<string, unknown>;
  /** Maximum number of objects */
  limit?: number;
  /** Sort order by modifiedAt: 'asc' or 'desc' (default: 'desc') */
  order?: 'asc' | 'desc';
}

/**
 * A reactive collection of objects that auto-updates when matching objects change.
 */
class ReactiveCollectionImpl {
  #space: RoolSpace;
  #options: CollectionOptions;
  #unsubscribers: (() => void)[] = [];
  #currentIds = new Set<string>();

  // Reactive state
  objects = $state<RoolObject[]>([]);
  loading = $state(true);

  constructor(space: RoolSpace, options: CollectionOptions) {
    this.#space = space;
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
    this.#space.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#space.off('objectCreated', onObjectCreated));

    const onObjectUpdated = ({ objectId, object }: { objectId: string; object: RoolObject }) => {
      const wasInCollection = this.#currentIds.has(objectId);
      const nowMatches = this.#matches(object);

      if (wasInCollection && nowMatches) {
        // Update in place
        const index = this.objects.findIndex((o) => o.id === objectId);
        if (index !== -1) {
          this.objects[index] = object;
        }
      } else if (wasInCollection && !nowMatches) {
        // Remove from collection
        this.objects = this.objects.filter((o) => o.id !== objectId);
        this.#currentIds.delete(objectId);
      } else if (!wasInCollection && nowMatches) {
        // Add to collection (re-fetch to respect limit/order)
        this.refresh();
      }
    };
    this.#space.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#space.off('objectUpdated', onObjectUpdated));

    const onObjectDeleted = ({ objectId }: { objectId: string }) => {
      if (this.#currentIds.has(objectId)) {
        this.objects = this.objects.filter((o) => o.id !== objectId);
        this.#currentIds.delete(objectId);
      }
    };
    this.#space.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#space.off('objectDeleted', onObjectDeleted));

    // Handle full resets
    const onReset = () => this.refresh();
    this.#space.on('reset', onReset);
    this.#unsubscribers.push(() => this.#space.off('reset', onReset));
  }

  /**
   * Check if an object matches the `where` filter.
   */
  #matches(object: RoolObject): boolean {
    const where = this.#options.where;
    if (!where) return true;

    for (const [key, value] of Object.entries(where)) {
      if (object[key] !== value) return false;
    }
    return true;
  }

  /**
   * Re-fetch the collection from the space.
   */
  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const findOptions: FindObjectsOptions = {
        where: this.#options.where,
        limit: this.#options.limit,
        order: this.#options.order,
        ephemeral: true, // Don't pollute conversation history
      };
      const { objects } = await this.#space.findObjects(findOptions);
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

export type ReactiveCollection = ReactiveCollectionImpl;

/**
 * A reactive single object that auto-updates when the object changes.
 */
class ReactiveObjectImpl {
  #space: RoolSpace;
  #objectId: string;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(space: RoolSpace, objectId: string) {
    this.#space = space;
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
    this.#space.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#space.off('objectUpdated', onObjectUpdated));

    // Listen for creation (in case object didn't exist initially)
    const onObjectCreated = ({ object }: { object: RoolObject }) => {
      if (object.id === this.#objectId) {
        this.data = object;
      }
    };
    this.#space.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#space.off('objectCreated', onObjectCreated));

    // Listen for deletion
    const onObjectDeleted = ({ objectId }: { objectId: string }) => {
      if (objectId === this.#objectId) {
        this.data = undefined;
      }
    };
    this.#space.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#space.off('objectDeleted', onObjectDeleted));

    // Handle full resets
    const onReset = () => this.refresh();
    this.#space.on('reset', onReset);
    this.#unsubscribers.push(() => this.#space.off('reset', onReset));
  }

  /**
   * Re-fetch the object from the space.
   */
  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.data = await this.#space.getObject(this.#objectId);
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

/**
 * Minimal wrapper that adds reactive `interactions` to RoolSpace.
 * All other properties and methods are proxied to the underlying space.
 */
class ReactiveSpaceImpl {
  #space: RoolSpace;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);
  conversations = $state<ConversationInfo[]>([]);
  #conversationId = $state<string>('');

  constructor(space: RoolSpace) {
    this.#space = space;
    this.interactions = space.getInteractions();
    this.#conversationId = space.conversationId;

    // Initial fetch of conversations (async)
    this.#refreshConversations();

    // Subscribe to conversation updates
    const onConversationUpdated = () => {
      this.interactions = space.getInteractions();
    };
    space.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => space.off('conversationUpdated', onConversationUpdated));

    const onReset = () => {
      this.interactions = space.getInteractions();
    };
    space.on('reset', onReset);
    this.#unsubscribers.push(() => space.off('reset', onReset));

    // Update interactions and conversationId when switching conversations
    const onConversationIdChanged = () => {
      this.#conversationId = space.conversationId;
      this.interactions = space.getInteractions();
    };
    space.on('conversationIdChanged', onConversationIdChanged);
    this.#unsubscribers.push(() => space.off('conversationIdChanged', onConversationIdChanged));

    // Update conversations list when conversations change
    const onConversationsChanged = () => {
      this.#refreshConversations();
    };
    space.on('conversationsChanged', onConversationsChanged);
    this.#unsubscribers.push(() => space.off('conversationsChanged', onConversationsChanged));
  }

  async #refreshConversations() {
    this.conversations = await this.#space.listConversations();
  }

  // Proxy read-only properties
  get id() { return this.#space.id; }
  get name() { return this.#space.name; }
  get role() { return this.#space.role; }
  get userId() { return this.#space.userId; }
  get conversationId() { return this.#conversationId; }
  set conversationId(id: string) { this.#space.conversationId = id; }

  // Proxy all methods
  close() {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    this.#space.close();
  }

  // Object operations
  getObject(...args: Parameters<RoolSpace['getObject']>) { return this.#space.getObject(...args); }
  stat(...args: Parameters<RoolSpace['stat']>) { return this.#space.stat(...args); }
  findObjects(...args: Parameters<RoolSpace['findObjects']>) { return this.#space.findObjects(...args); }
  getObjectIds(...args: Parameters<RoolSpace['getObjectIds']>) { return this.#space.getObjectIds(...args); }
  createObject(...args: Parameters<RoolSpace['createObject']>) { return this.#space.createObject(...args); }
  updateObject(...args: Parameters<RoolSpace['updateObject']>) { return this.#space.updateObject(...args); }
  deleteObjects(...args: Parameters<RoolSpace['deleteObjects']>) { return this.#space.deleteObjects(...args); }

  // Relations
  link(...args: Parameters<RoolSpace['link']>) { return this.#space.link(...args); }
  unlink(...args: Parameters<RoolSpace['unlink']>) { return this.#space.unlink(...args); }
  getParents(...args: Parameters<RoolSpace['getParents']>) { return this.#space.getParents(...args); }
  getChildren(...args: Parameters<RoolSpace['getChildren']>) { return this.#space.getChildren(...args); }

  // AI
  prompt(...args: Parameters<RoolSpace['prompt']>) { return this.#space.prompt(...args); }

  // Undo/redo
  checkpoint(...args: Parameters<RoolSpace['checkpoint']>) { return this.#space.checkpoint(...args); }
  canUndo() { return this.#space.canUndo(); }
  canRedo() { return this.#space.canRedo(); }
  undo() { return this.#space.undo(); }
  redo() { return this.#space.redo(); }
  clearHistory() { return this.#space.clearHistory(); }

  // Metadata
  setMetadata(...args: Parameters<RoolSpace['setMetadata']>) { return this.#space.setMetadata(...args); }
  getMetadata(...args: Parameters<RoolSpace['getMetadata']>) { return this.#space.getMetadata(...args); }
  getAllMetadata() { return this.#space.getAllMetadata(); }

  // Conversations
  getInteractions() { return this.#space.getInteractions(); }
  getInteractionsById(...args: Parameters<RoolSpace['getInteractionsById']>) { return this.#space.getInteractionsById(...args); }
  getConversationIds() { return this.#space.getConversationIds(); }
  deleteConversation(...args: Parameters<RoolSpace['deleteConversation']>) { return this.#space.deleteConversation(...args); }
  renameConversation(...args: Parameters<RoolSpace['renameConversation']>) { return this.#space.renameConversation(...args); }
  listConversations() { return this.#space.listConversations(); }
  getSystemInstruction() { return this.#space.getSystemInstruction(); }
  setSystemInstruction(...args: Parameters<RoolSpace['setSystemInstruction']>) { return this.#space.setSystemInstruction(...args); }

  // Media
  uploadMedia(...args: Parameters<RoolSpace['uploadMedia']>) { return this.#space.uploadMedia(...args); }
  fetchMedia(...args: Parameters<RoolSpace['fetchMedia']>) { return this.#space.fetchMedia(...args); }
  deleteMedia(...args: Parameters<RoolSpace['deleteMedia']>) { return this.#space.deleteMedia(...args); }
  listMedia() { return this.#space.listMedia(); }

  // Export/import
  exportArchive() { return this.#space.exportArchive(); }

  // Events
  on(...args: Parameters<RoolSpace['on']>) { return this.#space.on(...args); }
  off(...args: Parameters<RoolSpace['off']>) { return this.#space.off(...args); }

  // Reactive primitives

  /**
   * Create a reactive object that auto-updates when the object changes.
   *
   * @example
   * const article = space.object('article-123');
   * // article.data is reactive (RoolObject | undefined)
   * // article.loading indicates fetch status
   * // article.refresh() to manually re-fetch
   * // article.close() to stop listening
   */
  object(objectId: string): ReactiveObject {
    return new ReactiveObjectImpl(this.#space, objectId);
  }

  /**
   * Create a reactive collection that auto-updates when matching objects change.
   *
   * @example
   * const articles = space.collection({ where: { type: 'article' } });
   * // articles.objects is reactive
   * // articles.loading indicates fetch status
   * // articles.refresh() to manually re-fetch
   * // articles.close() to stop listening
   */
  collection(options: CollectionOptions): ReactiveCollection {
    return new ReactiveCollectionImpl(this.#space, options);
  }

  // Advanced
  rename(...args: Parameters<RoolSpace['rename']>) { return this.#space.rename(...args); }
  getData() { return this.#space.getData(); }
  get isReadOnly() { return this.#space.isReadOnly; }
  addUser(...args: Parameters<RoolSpace['addUser']>) { return this.#space.addUser(...args); }
  removeUser(...args: Parameters<RoolSpace['removeUser']>) { return this.#space.removeUser(...args); }
  listUsers() { return this.#space.listUsers(); }
  setLinkAccess(...args: Parameters<RoolSpace['setLinkAccess']>) { return this.#space.setLinkAccess(...args); }
  get linkAccess() { return this.#space.linkAccess; }
}

export function wrapSpace(space: RoolSpace): ReactiveSpace {
  return new ReactiveSpaceImpl(space);
}

export type ReactiveSpace = ReactiveSpaceImpl;
