import { isObjectPath, machinePath } from '@rool-dev/sdk';
import type {
  RoolSpace,
  Interaction,
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
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);

  constructor(space: RoolSpace, conversationId: string) {
    this.#conversationId = conversationId;
    this.#handle = space.conversation(conversationId);

    this.interactions = this.#handle.getInteractions();

    const onConversationUpdated = (event: ConversationUpdatedEvent) => {
      if (event.conversationId === this.#conversationId) {
        this.interactions = this.#handle.getInteractions();
      }
    };
    space.on('conversationUpdated', onConversationUpdated);
    this.#unsubscribers.push(() => space.off('conversationUpdated', onConversationUpdated));

    const onReset = () => {
      this.interactions = this.#handle.getInteractions();
    };
    space.on('reset', onReset);
    this.#unsubscribers.push(() => space.off('reset', onReset));
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
  delete() { return this.#handle.delete(); }

  // Object operations
  putObject(...args: Parameters<ConversationHandle['putObject']>) { return this.#handle.putObject(...args); }
  patchObject(...args: Parameters<ConversationHandle['patchObject']>) { return this.#handle.patchObject(...args); }
  moveObject(...args: Parameters<ConversationHandle['moveObject']>) { return this.#handle.moveObject(...args); }
  deleteObjects(...args: Parameters<ConversationHandle['deleteObjects']>) { return this.#handle.deleteObjects(...args); }
  /** @deprecated Use deleteObjects instead. */
  deletePaths(...args: Parameters<ConversationHandle['deletePaths']>) { return this.#handle.deletePaths(...args); }

  // AI
  prompt(...args: Parameters<ConversationHandle['prompt']>) { return this.#handle.prompt(...args); }
  stop() { return this.#handle.stop(); }

  // Schema
  createCollection(...args: Parameters<ConversationHandle['createCollection']>) { return this.#handle.createCollection(...args); }
  alterCollection(...args: Parameters<ConversationHandle['alterCollection']>) { return this.#handle.alterCollection(...args); }
  dropCollection(...args: Parameters<ConversationHandle['dropCollection']>) { return this.#handle.dropCollection(...args); }

  close(): void {
    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
  }
}

export type ReactiveConversationHandle = ReactiveConversationHandleImpl;


