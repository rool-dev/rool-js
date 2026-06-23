import type { RoolSpace, ConversationInfo, ConnectionState, RoolUserRole, SpaceMember } from '@rool-dev/sdk';
import { ReactiveConversationHandleImpl, ReactiveObjectImpl, ReactiveWatchImpl, type WatchOptions } from './space-session.svelte.js';
import { ReactiveFileTree } from './file-tree.svelte.js';

/**
 * A reactive wrapper around a RoolSpace. Exposes reactive `conversations` and
 * `connectionState`, plus space-level object/conversation/AI methods.
 *
 * Lifecycle: call `close()` when done to stop the space's SSE subscription.
 */
class ReactiveSpaceImpl {
  #space: RoolSpace;
  #unsubscribers: (() => void)[] = [];
  #fileTree: ReactiveFileTree;
  #closed = false;

  // Reactive state mirroring the underlying space
  #conversationList = $state<ConversationInfo[]>([]);
  connectionState = $state<ConnectionState>('reconnecting');

  constructor(space: RoolSpace) {
    this.#space = space;
    this.#fileTree = new ReactiveFileTree(space);
    this.#conversationList = [...space.conversations];

    const refreshConversations = () => { this.#conversationList = [...space.conversations]; };
    space.on('conversationUpdated', refreshConversations);
    this.#unsubscribers.push(() => space.off('conversationUpdated', refreshConversations));
    space.on('reset', refreshConversations);
    this.#unsubscribers.push(() => space.off('reset', refreshConversations));

    const onConnectionStateChanged = (state: ConnectionState) => {
      this.connectionState = state;
    };
    space.on('connectionStateChanged', onConnectionStateChanged);
    this.#unsubscribers.push(() => space.off('connectionStateChanged', onConnectionStateChanged));
  }

  get isClosed() { return this.#closed; }

  /** Get a reactive handle for a conversation in this space. */
  conversation(conversationId: string) {
    return new ReactiveConversationHandleImpl(this.#space, conversationId);
  }


  /**
   * Close this space and stop the SSE subscription. Idempotent.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;

    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;

    this.#fileTree.close();
    this.#space.close();
  }

  // Reactive getters
  get conversations(): ConversationInfo[] { return this.#conversationList; }

  // Proxy read-only properties
  get id(): string { return this.#space.id; }
  get name(): string { return this.#space.name; }
  get role(): RoolUserRole { return this.#space.role; }
  get memberCount(): number { return this.#space.memberCount; }
  get webdav() { return this.#space.webdav; }
  get fileTree(): ReactiveFileTree { return this.#fileTree; }

  // Space-level methods
  getObject(...args: Parameters<RoolSpace['getObject']>) { return this.#space.getObject(...args); }
  getObjects(...args: Parameters<RoolSpace['getObjects']>) { return this.#space.getObjects(...args); }
  object(path: string) { return new ReactiveObjectImpl(this.#space, this.#fileTree, path); }
  watch(options: WatchOptions) { return new ReactiveWatchImpl(this.#space, this.#fileTree, options); }
  stat(...args: Parameters<RoolSpace['stat']>) { return this.#space.stat(...args); }
  stopInteraction(...args: Parameters<RoolSpace['stopInteraction']>) { return this.#space.stopInteraction(...args); }
  checkpoint(...args: Parameters<RoolSpace['checkpoint']>) { return this.#space.checkpoint(...args); }
  canUndo(...args: Parameters<RoolSpace['canUndo']>) { return this.#space.canUndo(...args); }
  canRedo(...args: Parameters<RoolSpace['canRedo']>) { return this.#space.canRedo(...args); }
  undo(...args: Parameters<RoolSpace['undo']>) { return this.#space.undo(...args); }
  redo(...args: Parameters<RoolSpace['redo']>) { return this.#space.redo(...args); }
  clearHistory(...args: Parameters<RoolSpace['clearHistory']>) { return this.#space.clearHistory(...args); }
  getMetadata(...args: Parameters<RoolSpace['getMetadata']>) { return this.#space.getMetadata(...args); }
  getAllMetadata(...args: Parameters<RoolSpace['getAllMetadata']>) { return this.#space.getAllMetadata(...args); }
  getConversations(...args: Parameters<RoolSpace['getConversations']>) { return this.#space.getConversations(...args); }
  deleteConversation(...args: Parameters<RoolSpace['deleteConversation']>) { return this.#space.deleteConversation(...args); }
  getSchema(...args: Parameters<RoolSpace['getSchema']>) { return this.#space.getSchema(...args); }
  fetch(...args: Parameters<RoolSpace['fetch']>) { return this.#space.fetch(...args); }
  // Proxy resource methods
  getStorageUsage(...args: Parameters<RoolSpace['getStorageUsage']>) { return this.#space.getStorageUsage(...args); }
  fetchPath(...args: Parameters<RoolSpace['fetchPath']>) { return this.#space.fetchPath(...args); }

  // Proxy admin methods
  rename(newName: string): Promise<void> { return this.#space.rename(newName); }
  delete(): Promise<void> { return this.#space.delete(); }
  listUsers(): Promise<SpaceMember[]> { return this.#space.listUsers(); }
  setUserRole(...args: Parameters<RoolSpace['setUserRole']>) { return this.#space.setUserRole(...args); }
  removeUser(userId: string): Promise<void> { return this.#space.removeUser(userId); }
  createInvite(...args: Parameters<RoolSpace['createInvite']>) { return this.#space.createInvite(...args); }
  listInvites(...args: Parameters<RoolSpace['listInvites']>) { return this.#space.listInvites(...args); }
  revokeInvite(...args: Parameters<RoolSpace['revokeInvite']>) { return this.#space.revokeInvite(...args); }
  exportArchive(): Promise<Blob> { return this.#space.exportArchive(); }
  refresh(): Promise<void> { return this.#space.refresh(); }

  // Events on the underlying space (conversationUpdated, filesChanged, connectionStateChanged)
  on(...args: Parameters<RoolSpace['on']>) { return this.#space.on(...args); }
  off(...args: Parameters<RoolSpace['off']>) { return this.#space.off(...args); }
}

export function wrapSpace(space: RoolSpace): ReactiveSpace {
  return new ReactiveSpaceImpl(space);
}

export type ReactiveSpace = ReactiveSpaceImpl;
