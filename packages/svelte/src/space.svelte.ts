import type { RoolSpace, Interaction } from '@rool-dev/sdk';

/**
 * Minimal wrapper that adds reactive `interactions` to RoolSpace.
 * All other properties and methods are proxied to the underlying space.
 */
class ReactiveSpaceImpl {
  #space: RoolSpace;
  #unsubscribers: (() => void)[] = [];

  // Reactive state
  interactions = $state<Interaction[]>([]);

  constructor(space: RoolSpace) {
    this.#space = space;
    this.interactions = space.getInteractions();

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
  }

  // Proxy read-only properties
  get id() { return this.#space.id; }
  get name() { return this.#space.name; }
  get role() { return this.#space.role; }
  get userId() { return this.#space.userId; }
  get conversationId() { return this.#space.conversationId; }
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

  // Advanced
  rename(...args: Parameters<RoolSpace['rename']>) { return this.#space.rename(...args); }
  getData() { return this.#space.getData(); }
  get isReadOnly() { return this.#space.isReadOnly; }
  addUser(...args: Parameters<RoolSpace['addUser']>) { return this.#space.addUser(...args); }
  removeUser(...args: Parameters<RoolSpace['removeUser']>) { return this.#space.removeUser(...args); }
  listUsers() { return this.#space.listUsers(); }
}

export function wrapSpace(space: RoolSpace): ReactiveSpace {
  return new ReactiveSpaceImpl(space);
}

export type ReactiveSpace = ReactiveSpaceImpl;
