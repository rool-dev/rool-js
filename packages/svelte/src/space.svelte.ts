import type {
  RoolSpace,
  RoolObject,
  ConversationInfo,
  Interaction,
  FindObjectsOptions,
  PromptOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  RoolUserRole,
} from '@rool-dev/sdk';

// ===========================================================================
// Types
// ===========================================================================

export interface SpaceInfo {
  id: string;
  name: string;
  role: RoolUserRole;
}

// ===========================================================================
// AsyncValue - reactive async data wrapper
// ===========================================================================

export class AsyncValue<T> {
  value = $state<T | undefined>(undefined);
  loading = $state(false);
  error = $state<Error | null>(null);

  #fetcher: () => Promise<T>;

  constructor(fetcher: () => Promise<T>, fetchOnCreate = true) {
    this.#fetcher = fetcher;
    if (fetchOnCreate) {
      this.refresh();
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.value = await this.#fetcher();
    } catch (e) {
      this.error = e as Error;
    } finally {
      this.loading = false;
    }
  }

  set(value: T | undefined): void {
    this.value = value;
    this.error = null;
  }

  clear(): void {
    this.value = undefined;
    this.loading = false;
    this.error = null;
  }
}

// ===========================================================================
// SpaceHandle - reactive space wrapper
// ===========================================================================

class SpaceHandleImpl {
  #space: RoolSpace;
  #unsubscribers: (() => void)[] = [];

  // Store caches
  #objectCache = new Map<string, AsyncValue<RoolObject>>();
  #childrenCache = new Map<string, AsyncValue<RoolObject[]>>();
  #parentsCache = new Map<string, AsyncValue<RoolObject[]>>();
  #queryCache = new Map<string, AsyncValue<RoolObject[]>>();

  // Reactive state
  info = $state<SpaceInfo>({ id: '', name: '', role: 'viewer' });
  conversationId = $state('');
  conversations = $state<ConversationInfo[] | undefined>(undefined);
  conversationsLoading = $state(false);
  conversationsError = $state<Error | null>(null);
  interactions = $state<Interaction[]>([]);
  systemInstruction = $state<string | undefined>(undefined);

  constructor(space: RoolSpace) {
    this.#space = space;

    // Initialize state
    this.info = {
      id: space.id,
      name: space.name,
      role: space.role,
    };
    this.conversationId = space.conversationId;
    this.interactions = space.getInteractions();
    this.systemInstruction = space.getSystemInstruction();

    // Initial fetches
    this.#refreshConversations();

    // Setup event listeners
    this.#setupEventListeners();
  }

  #setupEventListeners() {
    // Object events
    const onObjectCreated = (event: { objectId: string; object: RoolObject }) => {
      const store = this.#objectCache.get(event.objectId);
      if (store) {
        store.set(event.object);
      }
    };
    this.#space.on('objectCreated', onObjectCreated);
    this.#unsubscribers.push(() => this.#space.off('objectCreated', onObjectCreated));

    const onObjectUpdated = (event: { objectId: string; object: RoolObject }) => {
      const store = this.#objectCache.get(event.objectId);
      if (store) {
        store.set(event.object);
      }
      this.#refreshRelationStoresForObject(event.objectId);
    };
    this.#space.on('objectUpdated', onObjectUpdated);
    this.#unsubscribers.push(() => this.#space.off('objectUpdated', onObjectUpdated));

    const onObjectDeleted = (event: { objectId: string }) => {
      const store = this.#objectCache.get(event.objectId);
      if (store) {
        store.set(undefined);
      }
      this.#refreshRelationStoresForObject(event.objectId);
    };
    this.#space.on('objectDeleted', onObjectDeleted);
    this.#unsubscribers.push(() => this.#space.off('objectDeleted', onObjectDeleted));

    // Link events
    const onLinked = (event: { sourceId: string; relation: string; targetId: string }) => {
      const childrenKey = JSON.stringify([event.sourceId, event.relation]);
      this.#childrenCache.get(childrenKey)?.refresh();
      const parentsKey = JSON.stringify([event.targetId, event.relation]);
      this.#parentsCache.get(parentsKey)?.refresh();
    };
    this.#space.on('linked', onLinked);
    this.#unsubscribers.push(() => this.#space.off('linked', onLinked));

    const onUnlinked = (event: { sourceId: string; relation: string; targetId: string }) => {
      const childrenKey = JSON.stringify([event.sourceId, event.relation]);
      this.#childrenCache.get(childrenKey)?.refresh();
      const parentsKey = JSON.stringify([event.targetId, event.relation]);
      this.#parentsCache.get(parentsKey)?.refresh();
    };
    this.#space.on('unlinked', onUnlinked);
    this.#unsubscribers.push(() => this.#space.off('unlinked', onUnlinked));

    // Conversation events
    const onConversationUpdated = (event: { conversationId: string }) => {
      if (event.conversationId === this.conversationId) {
        this.interactions = this.#space.getInteractions();
        this.systemInstruction = this.#space.getSystemInstruction();
      }
    };
    this.#space.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => this.#space.off('conversationUpdated', onConversationUpdated));

    const onConversationsChanged = () => {
      this.#refreshConversations();
    };
    this.#space.on('conversationsChanged', onConversationsChanged);
    this.#unsubscribers.push(() => this.#space.off('conversationsChanged', onConversationsChanged));

    const onConversationIdChanged = (event: { newConversationId: string }) => {
      this.conversationId = event.newConversationId;
      this.interactions = this.#space.getInteractions();
      this.systemInstruction = this.#space.getSystemInstruction();
    };
    this.#space.on('conversationIdChanged', onConversationIdChanged);
    this.#unsubscribers.push(() => this.#space.off('conversationIdChanged', onConversationIdChanged));

    // Reset event (undo/redo, resync)
    const onReset = () => {
      for (const store of this.#objectCache.values()) {
        store.refresh();
      }
      for (const store of this.#childrenCache.values()) {
        store.refresh();
      }
      for (const store of this.#parentsCache.values()) {
        store.refresh();
      }
      for (const store of this.#queryCache.values()) {
        store.refresh();
      }
      this.#refreshConversations();
      this.interactions = this.#space.getInteractions();
      this.systemInstruction = this.#space.getSystemInstruction();
    };
    this.#space.on('reset', onReset);
    this.#unsubscribers.push(() => this.#space.off('reset', onReset));
  }

  async #refreshConversations() {
    this.conversationsLoading = true;
    this.conversationsError = null;
    try {
      this.conversations = await this.#space.listConversations();
    } catch (e) {
      this.conversationsError = e as Error;
    } finally {
      this.conversationsLoading = false;
    }
  }

  #refreshRelationStoresForObject(objectId: string) {
    for (const store of this.#childrenCache.values()) {
      if (store.value?.some((obj) => obj.id === objectId)) {
        store.refresh();
      }
    }
    for (const store of this.#parentsCache.values()) {
      if (store.value?.some((obj) => obj.id === objectId)) {
        store.refresh();
      }
    }
  }

  // ===========================================================================
  // Conversation management
  // ===========================================================================

  setConversationId(id: string): void {
    if (id !== this.conversationId) {
      this.#space.conversationId = id;
      // Note: conversationIdChanged event will update our state
    }
  }

  async setSystemInstruction(instruction: string | null): Promise<void> {
    await this.#space.setSystemInstruction(instruction);
    this.systemInstruction = instruction ?? undefined;
  }

  refreshConversations(): Promise<void> {
    return this.#refreshConversations();
  }

  // ===========================================================================
  // Object store factories
  // ===========================================================================

  object(id: string): AsyncValue<RoolObject> {
    const cached = this.#objectCache.get(id);
    if (cached) return cached;

    const store = new AsyncValue<RoolObject>(async () => {
      const obj = await this.#space.getObject(id);
      if (!obj) throw new Error(`Object not found: ${id}`);
      return obj;
    });

    this.#objectCache.set(id, store);
    return store;
  }

  children(id: string, relation: string): AsyncValue<RoolObject[]> {
    const key = JSON.stringify([id, relation]);
    const cached = this.#childrenCache.get(key);
    if (cached) return cached;

    const store = new AsyncValue<RoolObject[]>(() => this.#space.getChildren(id, relation));

    this.#childrenCache.set(key, store);
    return store;
  }

  parents(id: string, relation: string): AsyncValue<RoolObject[]> {
    const key = JSON.stringify([id, relation]);
    const cached = this.#parentsCache.get(key);
    if (cached) return cached;

    const store = new AsyncValue<RoolObject[]>(() => this.#space.getParents(id, relation));

    this.#parentsCache.set(key, store);
    return store;
  }

  query(options: FindObjectsOptions): AsyncValue<RoolObject[]> {
    const key = JSON.stringify(options);
    const cached = this.#queryCache.get(key);
    if (cached) return cached;

    const store = new AsyncValue<RoolObject[]>(async () => {
      const result = await this.#space.findObjects(options);
      return result.objects;
    });

    this.#queryCache.set(key, store);
    return store;
  }

  // ===========================================================================
  // Mutations (passthrough to SDK)
  // ===========================================================================

  createObject(options: CreateObjectOptions) {
    return this.#space.createObject(options);
  }

  updateObject(objectId: string, options: UpdateObjectOptions) {
    return this.#space.updateObject(objectId, options);
  }

  deleteObjects(objectIds: string[]) {
    return this.#space.deleteObjects(objectIds);
  }

  link(sourceId: string, relation: string, targetId: string) {
    return this.#space.link(sourceId, relation, targetId);
  }

  unlink(sourceId: string, relation?: string, targetId?: string) {
    return this.#space.unlink(sourceId, relation, targetId);
  }

  prompt(text: string, options?: PromptOptions) {
    return this.#space.prompt(text, options);
  }

  checkpoint(label?: string) {
    return this.#space.checkpoint(label);
  }

  undo() {
    return this.#space.undo();
  }

  redo() {
    return this.#space.redo();
  }

  // ===========================================================================
  // Conversation management (passthrough)
  // ===========================================================================

  deleteConversation(conversationId?: string) {
    return this.#space.deleteConversation(conversationId);
  }

  renameConversation(conversationId: string, name: string) {
    return this.#space.renameConversation(conversationId, name);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  close(): void {
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers.length = 0;

    for (const store of this.#objectCache.values()) {
      store.clear();
    }
    this.#objectCache.clear();

    for (const store of this.#childrenCache.values()) {
      store.clear();
    }
    this.#childrenCache.clear();

    for (const store of this.#parentsCache.values()) {
      store.clear();
    }
    this.#parentsCache.clear();

    for (const store of this.#queryCache.values()) {
      store.clear();
    }
    this.#queryCache.clear();

    this.#space.close();
  }
}

/**
 * Create a SpaceHandle from a RoolSpace instance.
 */
export function createSpaceHandle(space: RoolSpace): SpaceHandle {
  return new SpaceHandleImpl(space);
}

export type SpaceHandle = SpaceHandleImpl;
