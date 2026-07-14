import type {
  RoolSpace,
  Conversation,
  ConversationMeta,
  ConversationUpdatedEvent,
  ConnectionState,
  OpenSpaceResult,
  RoolUserRole,
  SpaceMember,
  SpaceSchema,
} from '@rool-dev/sdk';
import { ReactiveConversationHandleImpl, ReactiveObjectImpl, ReactiveWatchImpl, type WatchOptions } from './space-session.svelte.js';
import { ReactiveFileTree, type ReactiveFileTreeEvent } from './file-tree.svelte.js';

function conversationMeta(id: string, conversation: Conversation, updatedAt: number): ConversationMeta {
  return {
    id,
    agent: conversation.agent ?? 'rool',
    visibility: conversation.visibility ?? 'shared',
    name: conversation.name ?? null,
    systemInstruction: conversation.systemInstruction ?? null,
    createdAt: conversation.createdAt,
    createdBy: conversation.createdBy,
    interactionCount: Object.keys(conversation.interactions).length,
    updatedAt,
  };
}

/**
 * A reactive wrapper around a RoolSpace. Exposes reactive `conversations`,
 * `connectionState`, `meta`, and `schema`, plus space-level
 * object/conversation/AI methods.
 *
 * `meta` and `schema` are read from the WebDAV filesystem (`/space/.meta.json`,
 * `/space/<collection>/.schema.json`) and re-fetched when the file tree reports
 * those nodes changed — so remote writes propagate the same as local ones. The
 * underlying SDK space holds no schema/meta state; this wrapper owns the
 * reactive presentation of it.
 *
 * Lifecycle: call `close()` when done to stop the space's SSE subscription.
 */
class ReactiveSpaceImpl {
  #space: RoolSpace;
  #unsubscribers: (() => void)[] = [];
  #fileTree: ReactiveFileTree;
  #conversationHandles = new Map<string, ReactiveConversationHandleImpl>();
  #onClose: () => void;
  #closed = false;

  #name = $state('');
  #role = $state<RoolUserRole>('viewer');
  #memberCount = $state(0);
  #conversationList = $state<ConversationMeta[]>([]);
  #conversationRevision = 0;
  connectionState = $state<ConnectionState>('reconnecting');
  openSpaceError = $state<Error | null>(null);

  // Reactive space content read from the WebDAV filesystem.
  meta = $state<Record<string, unknown>>({});
  schema = $state<SpaceSchema>({});

  // Initial load promises, awaited by ready() so callers can open a space with
  // meta/schema already populated (avoids a default-theme flash on switch).
  #metaReady: Promise<void> = Promise.resolve();
  #schemaReady: Promise<void> = Promise.resolve();

  constructor(space: RoolSpace, onClose: () => void) {
    this.#space = space;
    this.#onClose = onClose;
    this.#fileTree = new ReactiveFileTree(space);
    this.connectionState = space.connectionState;
    this.#applyOpenSpace(space.openSpaceResult, true);

    const updateConversation = (event: ConversationUpdatedEvent) => {
      this.#conversationRevision += 1;
      if (event.conversation === null) {
        this.#conversationList = this.#conversationList.filter((conversation) => conversation.id !== event.conversationId);
        return;
      }
      const next = conversationMeta(event.conversationId, event.conversation, event.timestamp);
      const index = this.#conversationList.findIndex((conversation) => conversation.id === event.conversationId);
      this.#conversationList = index === -1
        ? [next, ...this.#conversationList]
        : [
            ...this.#conversationList.slice(0, index),
            next,
            ...this.#conversationList.slice(index + 1),
          ];
    };
    space.on('conversationUpdated', updateConversation);
    this.#unsubscribers.push(() => space.off('conversationUpdated', updateConversation));

    const onConnectionStateChanged = (state: ConnectionState) => {
      this.connectionState = state;
      if (state === 'connected') this.#reloadAfterConnection();
    };
    space.on('connectionStateChanged', onConnectionStateChanged);
    this.#unsubscribers.push(() => space.off('connectionStateChanged', onConnectionStateChanged));
    if (this.connectionState === 'connected') this.#reloadAfterConnection();

    // Seed meta/schema from the filesystem, and re-fetch the relevant one when
    // the file tree reports its node changed. Remote writes (another tab, the
    // agent) land here the same as local ones.
    this.#metaReady = this.#refreshMeta();
    this.#schemaReady = this.#refreshSchema();
    const onTree = (event: ReactiveFileTreeEvent) => {
      const paths = new Set([...event.changedPaths, ...event.deletedPaths]);
      if (event.reset || paths.has('/space/.meta.json')) void this.#refreshMeta();
      if (event.reset || [...paths].some((p) => p.endsWith('/.schema.json'))) void this.#refreshSchema();
    };
    this.#unsubscribers.push(this.#fileTree.subscribe(onTree));
  }

  async #refreshMeta(): Promise<void> {
    if (this.#closed) return;
    this.meta = await this.#space.readMeta();
  }

  async #refreshSchema(): Promise<void> {
    if (this.#closed) return;
    this.schema = await this.#space.readSchema();
  }

  #applyOpenSpace(result: OpenSpaceResult, replaceConversations: boolean): void {
    this.#name = result.name;
    this.#role = result.role;
    this.#memberCount = result.memberCount;
    if (replaceConversations) this.#conversationList = [...result.conversationMeta];
    this.openSpaceError = null;
  }

  async #refreshOpenSpace(): Promise<void> {
    const conversationRevision = this.#conversationRevision;
    const result = await this.#space.refresh();
    this.#applyOpenSpace(result, conversationRevision === this.#conversationRevision);
  }

  #reloadAfterConnection(): void {
    void this.#refreshOpenSpace().catch((error) => {
      this.openSpaceError = error instanceof Error ? error : new Error(String(error));
    });
    for (const conversation of this.#conversationHandles.values()) void conversation.refresh();
  }

  /** Resolve when the initial meta/schema fetch has settled. */
  async ready(): Promise<void> {
    await Promise.all([this.#metaReady, this.#schemaReady]);
  }

  /**
   * Set one metadata key, merging into the reactive `meta` and writing the full
   * blob to `/space/.meta.json`. A `null`/`undefined` value deletes the key.
   * The file tree reconciles `meta` after the write lands.
   */
  async setMeta(key: string, value: unknown): Promise<void> {
    const next = { ...this.meta };
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
    this.meta = next;
    await this.#space.writeMeta(next);
  }

  get isClosed() { return this.#closed; }

  /** Get the shared reactive handle for one lazily loaded conversation. */
  conversation(conversationId: string): ReactiveConversationHandleImpl {
    const existing = this.#conversationHandles.get(conversationId);
    if (existing) return existing;

    const conversation = new ReactiveConversationHandleImpl(this.#space, conversationId, () => {
      if (this.#conversationHandles.get(conversationId) === conversation) {
        this.#conversationHandles.delete(conversationId);
      }
    });
    this.#conversationHandles.set(conversationId, conversation);
    return conversation;
  }


  /**
   * Close this space and stop the SSE subscription. Idempotent.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;

    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;
    for (const conversation of this.#conversationHandles.values()) conversation.close();
    this.#conversationHandles.clear();

    this.#fileTree.close();
    this.#space.close();
    this.#onClose();
  }

  // Reactive getters
  get conversations(): ConversationMeta[] { return this.#conversationList; }

  // Proxy read-only properties
  get id(): string { return this.#space.id; }
  get name(): string { return this.#name; }
  get role(): RoolUserRole { return this.#role; }
  get memberCount(): number { return this.#memberCount; }
  get webdav() { return this.#space.webdav; }
  get fileTree(): ReactiveFileTree { return this.#fileTree; }

  // Space-level methods
  getObject(...args: Parameters<RoolSpace['getObject']>) { return this.#space.getObject(...args); }
  getObjects(...args: Parameters<RoolSpace['getObjects']>) { return this.#space.getObjects(...args); }
  putObject(...args: Parameters<RoolSpace['putObject']>) { return this.#space.putObject(...args); }
  patchObject(...args: Parameters<RoolSpace['patchObject']>) { return this.#space.patchObject(...args); }
  moveObject(...args: Parameters<RoolSpace['moveObject']>) { return this.#space.moveObject(...args); }
  deleteObjects(...args: Parameters<RoolSpace['deleteObjects']>) { return this.#space.deleteObjects(...args); }
  createCollection(...args: Parameters<RoolSpace['createCollection']>) { return this.#space.createCollection(...args); }
  alterCollection(...args: Parameters<RoolSpace['alterCollection']>) { return this.#space.alterCollection(...args); }
  dropCollection(...args: Parameters<RoolSpace['dropCollection']>) { return this.#space.dropCollection(...args); }
  object(path: string) { return new ReactiveObjectImpl(this.#space, this.#fileTree, path); }
  watch(options: WatchOptions) { return new ReactiveWatchImpl(this.#space, this.#fileTree, options); }
  stopConversation(...args: Parameters<RoolSpace['stopConversation']>) { return this.#space.stopConversation(...args); }
  canUndo(...args: Parameters<RoolSpace['canUndo']>) { return this.#space.canUndo(...args); }
  canRedo(...args: Parameters<RoolSpace['canRedo']>) { return this.#space.canRedo(...args); }
  undo(...args: Parameters<RoolSpace['undo']>) { return this.#space.undo(...args); }
  redo(...args: Parameters<RoolSpace['redo']>) { return this.#space.redo(...args); }
  createConversation(...args: Parameters<RoolSpace['createConversation']>) { return this.#space.createConversation(...args); }
  deleteConversation(...args: Parameters<RoolSpace['deleteConversation']>) { return this.#space.deleteConversation(...args); }
  listAgents(...args: Parameters<RoolSpace['listAgents']>) { return this.#space.listAgents(...args); }
  deleteAgent(...args: Parameters<RoolSpace['deleteAgent']>) { return this.#space.deleteAgent(...args); }
  /** Rename a conversation without acquiring a reactive handle (avoids an unnecessary content fetch). */
  renameConversation(conversationId: string, name: string): Promise<void> {
    return this.#space.conversation(conversationId).rename(name);
  }
  fetch(...args: Parameters<RoolSpace['fetch']>) { return this.#space.fetch(...args); }
  // Proxy resource methods
  getStorageUsage(...args: Parameters<RoolSpace['getStorageUsage']>) { return this.#space.getStorageUsage(...args); }
  fetchPath(...args: Parameters<RoolSpace['fetchPath']>) { return this.#space.fetchPath(...args); }

  // Proxy admin methods
  async rename(newName: string): Promise<void> {
    await this.#space.rename(newName);
    this.#name = newName;
  }
  async delete(): Promise<void> {
    await this.#space.delete();
    this.close();
  }
  listUsers(): Promise<SpaceMember[]> { return this.#space.listUsers(); }
  setUserRole(...args: Parameters<RoolSpace['setUserRole']>) { return this.#space.setUserRole(...args); }
  removeUser(userId: string): Promise<void> { return this.#space.removeUser(userId); }
  createInvite(...args: Parameters<RoolSpace['createInvite']>) { return this.#space.createInvite(...args); }
  listInvites(...args: Parameters<RoolSpace['listInvites']>) { return this.#space.listInvites(...args); }
  revokeInvite(...args: Parameters<RoolSpace['revokeInvite']>) { return this.#space.revokeInvite(...args); }
  exportArchive(): Promise<Blob> { return this.#space.exportArchive(); }
  refresh(): Promise<void> { return this.#refreshOpenSpace(); }

  // Events on the underlying space (conversationUpdated, filesChanged, connectionStateChanged)
  on(...args: Parameters<RoolSpace['on']>) { return this.#space.on(...args); }
  off(...args: Parameters<RoolSpace['off']>) { return this.#space.off(...args); }
}

export function wrapSpace(space: RoolSpace, onClose: () => void = () => {}): ReactiveSpace {
  return new ReactiveSpaceImpl(space, onClose);
}

export type ReactiveSpace = ReactiveSpaceImpl;
