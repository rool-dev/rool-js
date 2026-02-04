import { RoolClient, type RoolSpaceInfo, type ConnectionState } from '@rool-dev/sdk';
import { createSpaceHandle, type SpaceHandle } from './space.svelte.js';

/**
 * Rool client with reactive state using Svelte 5 runes.
 */
class RoolImpl {
  #client: RoolClient;
  #unsubscribers: (() => void)[] = [];
  #openSpaces: Set<SpaceHandle> = new Set();

  // Reactive state
  authenticated = $state(false);
  spaces = $state<RoolSpaceInfo[] | undefined>(undefined);
  spacesLoading = $state(false);
  spacesError = $state<Error | null>(null);
  connectionState = $state<ConnectionState>('disconnected');

  constructor() {
    this.#client = new RoolClient();
    this.#setupEventListeners();
  }

  #setupEventListeners() {
    const onAuthStateChanged = (auth: boolean) => {
      this.authenticated = auth;
      if (auth) {
        this.#refreshSpaces();
      } else {
        this.spaces = undefined;
      }
    };
    this.#client.on('authStateChanged', onAuthStateChanged);
    this.#unsubscribers.push(() => this.#client.off('authStateChanged', onAuthStateChanged));

    const onConnectionStateChanged = (state: ConnectionState) => {
      this.connectionState = state;
    };
    this.#client.on('connectionStateChanged', onConnectionStateChanged);
    this.#unsubscribers.push(() => this.#client.off('connectionStateChanged', onConnectionStateChanged));

    const onSpaceCreated = () => this.#refreshSpaces();
    this.#client.on('spaceCreated', onSpaceCreated);
    this.#unsubscribers.push(() => this.#client.off('spaceCreated', onSpaceCreated));

    const onSpaceDeleted = () => this.#refreshSpaces();
    this.#client.on('spaceDeleted', onSpaceDeleted);
    this.#unsubscribers.push(() => this.#client.off('spaceDeleted', onSpaceDeleted));

    const onSpaceRenamed = () => this.#refreshSpaces();
    this.#client.on('spaceRenamed', onSpaceRenamed);
    this.#unsubscribers.push(() => this.#client.off('spaceRenamed', onSpaceRenamed));
  }

  async #refreshSpaces() {
    this.spacesLoading = true;
    this.spacesError = null;
    try {
      this.spaces = await this.#client.listSpaces();
    } catch (e) {
      this.spacesError = e as Error;
    } finally {
      this.spacesLoading = false;
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  init(): boolean {
    return this.#client.initialize();
  }

  login(appName: string): void {
    this.#client.login(appName);
  }

  logout(): void {
    for (const space of this.#openSpaces) {
      space.close();
    }
    this.#openSpaces.clear();
    this.#client.logout();
  }

  // ===========================================================================
  // Space Lifecycle
  // ===========================================================================

  async openSpace(id: string, options?: { conversationId?: string }): Promise<SpaceHandle> {
    const sdkSpace = await this.#client.openSpace(id, options);
    const handle = createSpaceHandle(sdkSpace);
    this.#openSpaces.add(handle);

    // Track when closed
    const originalClose = handle.close.bind(handle);
    handle.close = () => {
      this.#openSpaces.delete(handle);
      originalClose();
    };

    return handle;
  }

  async createSpace(name?: string, options?: { conversationId?: string }): Promise<SpaceHandle> {
    const sdkSpace = await this.#client.createSpace(name, options);
    const handle = createSpaceHandle(sdkSpace);
    this.#openSpaces.add(handle);

    // Track when closed
    const originalClose = handle.close.bind(handle);
    handle.close = () => {
      this.#openSpaces.delete(handle);
      originalClose();
    };

    return handle;
  }

  // ===========================================================================
  // Spaces management
  // ===========================================================================

  refreshSpaces(): Promise<void> {
    return this.#refreshSpaces();
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    for (const space of this.#openSpaces) {
      space.close();
    }
    this.#openSpaces.clear();

    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers.length = 0;

    this.#client.destroy();
  }
}

/**
 * Create a new Rool instance.
 */
export function createRool(): RoolImpl {
  return new RoolImpl();
}

/**
 * Generate a unique 6-character alphanumeric ID.
 */
export function generateId(): string {
  return RoolClient.generateId();
}

export type Rool = RoolImpl;
