import {
  conversationBranch,
  defaultConversationLeaf,
  generateEntityId,
  isObjectPath,
  machinePath,
} from '@rool-dev/sdk';
import type {
  RoolSpace,
  Interaction,
  Conversation,
  RoolObject,
  ConversationHandle,
  ConversationUpdatedEvent,
} from '@rool-dev/sdk';
import { ReactiveFileTree, type ReactiveFilePath, type ReactiveFileTreeEvent } from './file-tree.svelte.js';

/**
 * Options for creating a reactive watch.
 * Structured object filter for reactive updates.
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

function objectCollection(path: string): string | undefined {
  if (!isObjectPath(path)) return undefined;
  return path.split('/')[2];
}

function eventTouchesObject(event: ReactiveFileTreeEvent, objectPath?: string, collection?: string): boolean {
  if (event.reset) return true;
  for (const path of [...event.changedPaths, ...event.deletedPaths]) {
    if (objectPath && path === objectPath) return true;
    if (!objectPath && isObjectPath(path)) {
      if (!collection || objectCollection(path) === collection) return true;
    }
  }
  return false;
}

function sameJsonValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function watchObjectsFromTree(
  space: RoolSpace,
  fileTree: ReactiveFileTree,
  options: WatchOptions,
): Promise<RoolObject[]> {
  if (fileTree.loading) await fileTree.ready();
  const paths = fileTree.objectPaths({ collection: options.collection, order: options.order });
  const objects: RoolObject[] = [];
  for (const path of paths) {
    const object = await space.getObject(path);
    if (!object) continue;
    if (options.where) {
      let matches = true;
      for (const [key, value] of Object.entries(options.where)) {
        if (!sameJsonValue(object.body[key], value)) { matches = false; break; }
      }
      if (!matches) continue;
    }
    objects.push(object);
    if (options.limit !== undefined && objects.length >= options.limit) break;
  }
  return objects;
}

/**
 * A reactive watch of objects that auto-updates when matching object files change.
 */
export class ReactiveWatchImpl {
  #space: RoolSpace;
  #fileTree: ReactiveFileTree;
  #options: WatchOptions;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  objects = $state<RoolObject[]>([]);
  loading = $state(true);

  constructor(space: RoolSpace, fileTree: ReactiveFileTree, options: WatchOptions) {
    this.#space = space;
    this.#fileTree = fileTree;
    this.#options = options;
    this.#setup();
  }

  #setup() {
    this.refresh();

    const unsubscribe = this.#fileTree.subscribe((event) => {
      if (eventTouchesObject(event, undefined, this.#options.collection)) void this.refresh();
    });
    this.#unsubscribers.push(unsubscribe);
  }

  /** Re-fetch matching objects using the canonical file tree for paths. */
  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.objects = await watchObjectsFromTree(this.#space, this.#fileTree, this.#options);
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
export class ReactiveObjectImpl {
  #space: RoolSpace;
  #fileTree: ReactiveFileTree;
  #path: ReactiveFilePath;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(space: RoolSpace, fileTree: ReactiveFileTree, path: string) {
    this.#space = space;
    this.#fileTree = fileTree;
    this.#path = machinePath(path) as ReactiveFilePath;
    this.#setup();
  }

  #setup() {
    this.refresh();

    const unsubscribe = this.#fileTree.subscribe((event) => {
      if (event.deletedPaths.has(this.#path)) {
        this.data = undefined;
        return;
      }
      if (eventTouchesObject(event, this.#path)) void this.refresh();
    });
    this.#unsubscribers.push(unsubscribe);
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.data = await this.#space.getObject(this.#path);
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

export class ReactiveConversationHandleImpl {
  #handle: ConversationHandle;
  #conversationId: string;
  #activeLeafId = $state<string | undefined>(undefined);
  #revision = 0;
  #closed = false;
  #unsubscribers: (() => void)[] = [];
  #onClose: () => void;

  data = $state<Conversation | null | undefined>(undefined);
  interactions = $state<Interaction[]>([]);
  loading = $state(true);
  error = $state<Error | null>(null);

  constructor(space: RoolSpace, conversationId: string, onClose: () => void) {
    this.#conversationId = conversationId;
    this.#handle = space.conversation(conversationId);
    this.#onClose = onClose;
    void this.refresh();

    const onConversationUpdated = (event: ConversationUpdatedEvent) => {
      if (event.conversationId !== this.#conversationId) return;
      this.#revision += 1;
      this.#apply(event.conversation);
    };
    space.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => space.off('conversationUpdated', onConversationUpdated));
  }

  get conversationId(): string { return this.#conversationId; }
  get activeLeafId(): string | undefined { return this.#activeLeafId; }

  async refresh(): Promise<void> {
    const revision = this.#revision;
    this.loading = true;
    this.error = null;
    try {
      const conversation = await this.#handle.get();
      if (!this.#closed && revision === this.#revision) this.#apply(conversation);
    } catch (error) {
      if (!this.#closed) this.error = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (!this.#closed) this.loading = false;
    }
  }

  getInteractions(): Interaction[] { return this.interactions; }
  getTree(): Record<string, Interaction> { return this.data?.interactions ?? {}; }

  setActiveLeaf(interactionId: string): void {
    if (!this.data?.interactions[interactionId]) {
      throw new Error(`Interaction "${interactionId}" not found in conversation "${this.#conversationId}"`);
    }
    this.#revision += 1;
    this.#activeLeafId = interactionId;
    this.interactions = conversationBranch(this.data, interactionId);
  }

  getSystemInstruction(): string | undefined { return this.data?.systemInstruction; }
  setSystemInstruction(...args: Parameters<ConversationHandle['setSystemInstruction']>) { return this.#handle.setSystemInstruction(...args); }
  rename(...args: Parameters<ConversationHandle['rename']>) { return this.#handle.rename(...args); }
  delete() { return this.#handle.delete(); }

  async prompt(
    text: string,
    options?: Parameters<ConversationHandle['prompt']>[1],
  ): ReturnType<ConversationHandle['prompt']> {
    const previousLeaf = this.#activeLeafId;
    const interactionId = options?.interactionId ?? generateEntityId();
    this.#revision += 1;
    this.#activeLeafId = interactionId;
    try {
      return await this.#handle.prompt(text, {
        ...options,
        interactionId,
        parentInteractionId: options?.parentInteractionId === undefined
          ? previousLeaf ?? null
          : options.parentInteractionId,
      });
    } catch (error) {
      if (this.#activeLeafId === interactionId) this.#activeLeafId = previousLeaf;
      throw error;
    }
  }

  stop() { return this.#handle.stop(); }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    this.#onClose();
  }

  #apply(conversation: Conversation | null): void {
    this.data = conversation;
    if (!conversation) {
      this.#activeLeafId = undefined;
      this.interactions = [];
      return;
    }

    const currentLeaf = this.#activeLeafId;
    if (currentLeaf) {
      const child = Object.values(conversation.interactions).find((interaction) => interaction.parentId === currentLeaf);
      if (child) this.#activeLeafId = child.id;
    }
    if (!this.#activeLeafId || !conversation.interactions[this.#activeLeafId]) {
      this.#activeLeafId = defaultConversationLeaf(conversation);
    }
    this.interactions = conversationBranch(conversation, this.#activeLeafId);
  }
}

export type ReactiveConversationHandle = ReactiveConversationHandleImpl;


