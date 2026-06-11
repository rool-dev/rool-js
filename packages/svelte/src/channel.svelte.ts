import { isObjectPath, machinePath } from '@rool-dev/sdk';
import type {
  RoolChannel,
  RoolSpace,
  Interaction,
  RoolObject,
  ChannelInfo,
  ConversationInfo,
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
  channel: RoolChannel,
  fileTree: ReactiveFileTree,
  options: WatchOptions,
): Promise<RoolObject[]> {
  if (fileTree.loading) await fileTree.ready();
  const paths = fileTree.objectPaths({ collection: options.collection, order: options.order });
  const objects: RoolObject[] = [];
  for (const path of paths) {
    const object = await channel.getObject(path);
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
class ReactiveWatchImpl {
  #channel: RoolChannel;
  #fileTree: ReactiveFileTree;
  #options: WatchOptions;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  objects = $state<RoolObject[]>([]);
  loading = $state(true);

  constructor(channel: RoolChannel, fileTree: ReactiveFileTree, options: WatchOptions) {
    this.#channel = channel;
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
      this.objects = await watchObjectsFromTree(this.#channel, this.#fileTree, this.#options);
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
  #fileTree: ReactiveFileTree;
  #path: ReactiveFilePath;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  data = $state<RoolObject | undefined>(undefined);
  loading = $state(true);

  constructor(channel: RoolChannel, fileTree: ReactiveFileTree, path: string) {
    this.#channel = channel;
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
      this.data = await this.#channel.getObject(this.#path);
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
  #fileTree: ReactiveFileTree;
  #unsubscribers: (() => void)[] = [];
  #closed = false;

  // Reactive state
  interactions = $state<Interaction[]>([]);
  objectPaths = $state<string[]>([]);
  collections = $state<string[]>([]);
  conversations = $state<ConversationInfo[]>([]);

  constructor(channel: RoolChannel, fileTree: ReactiveFileTree) {
    this.#channel = channel;
    this.#fileTree = fileTree;
    this.interactions = channel.getInteractions();
    this.objectPaths = fileTree.objectPaths();
    this.collections = fileTree.collections();
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

    const refreshFromFileTree = () => {
      this.objectPaths = fileTree.objectPaths();
      this.collections = fileTree.collections();
    };
    this.#unsubscribers.push(fileTree.subscribe((event) => {
      if (event.reset || eventTouchesObject(event) || [...event.changedPaths, ...event.deletedPaths].some((path) => path === '/space' || path.startsWith('/space/'))) {
        refreshFromFileTree();
      }
    }));

    const onReset = () => {
      this.interactions = channel.getInteractions();
      refreshFromFileTree();
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
  getObjects(...args: Parameters<RoolChannel['getObjects']>) { return this.#channel.getObjects(...args); }
  stat(...args: Parameters<RoolChannel['stat']>) { return this.#channel.stat(...args); }
  putObject(...args: Parameters<RoolChannel['putObject']>) { return this.#channel.putObject(...args); }
  patchObject(...args: Parameters<RoolChannel['patchObject']>) { return this.#channel.patchObject(...args); }
  moveObject(...args: Parameters<RoolChannel['moveObject']>) { return this.#channel.moveObject(...args); }
  deleteObjects(...args: Parameters<RoolChannel['deleteObjects']>) { return this.#channel.deleteObjects(...args); }
  /** @deprecated Use deleteObjects instead. */
  deletePaths(...args: Parameters<RoolChannel['deletePaths']>) { return this.#channel.deletePaths(...args); }

  // AI
  prompt(...args: Parameters<RoolChannel['prompt']>) { return this.#channel.prompt(...args); }
  stop() { return this.#channel.stop(); }
  stopInteraction(...args: Parameters<RoolChannel['stopInteraction']>) { return this.#channel.stopInteraction(...args); }

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
   * Create a reactive object that auto-updates when the object at this path changes.
   */
  object(path: string): ReactiveObject {
    if (this.#closed) throw new Error('Cannot create reactive object: channel is closed');
    return new ReactiveObjectImpl(this.#channel, this.#fileTree, path);
  }

  /**
   * Create a reactive watch that auto-updates when matching objects change.
   */
  watch(options: WatchOptions): ReactiveWatch {
    if (this.#closed) throw new Error('Cannot create reactive watch: channel is closed');
    return new ReactiveWatchImpl(this.#channel, this.#fileTree, options);
  }

}

export function wrapChannel(channel: RoolChannel, fileTree: ReactiveFileTree): ReactiveChannel {
  return new ReactiveChannelImpl(channel, fileTree);
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
