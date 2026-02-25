import { RoolClient, type RoolSpaceInfo, type ConnectionState, type RoolClientConfig, type CurrentUser } from '@rool-dev/sdk';
import { wrapSpace, type ReactiveSpace } from './space.svelte.js';

/**
 * Rool client with reactive state for Svelte 5.
 *
 * Provides:
 * - Reactive auth state (`authenticated`)
 * - Reactive spaces list (`spaces`)
 * - Reactive user storage (`userStorage`)
 * - Direct access to SDK spaces (no wrapper abstraction)
 */
class RoolImpl {
  #client: RoolClient;
  #unsubscribers: (() => void)[] = [];
  #openSpaces: Set<ReactiveSpace> = new Set();

  // Reactive state
  authenticated = $state<boolean | null>(null); // null = checking, false = not auth, true = auth
  spaces = $state<RoolSpaceInfo[] | undefined>(undefined);
  spacesLoading = $state(false);
  spacesError = $state<Error | null>(null);
  connectionState = $state<ConnectionState>('disconnected');
  userStorage = $state<Record<string, unknown>>({});
  currentUser = $state<CurrentUser | null>(null);

  constructor(config?: RoolClientConfig) {
    this.#client = new RoolClient(config);
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

    const onSpaceAdded = () => this.#refreshSpaces();
    this.#client.on('spaceAdded', onSpaceAdded);
    this.#unsubscribers.push(() => this.#client.off('spaceAdded', onSpaceAdded));

    const onSpaceRemoved = () => this.#refreshSpaces();
    this.#client.on('spaceRemoved', onSpaceRemoved);
    this.#unsubscribers.push(() => this.#client.off('spaceRemoved', onSpaceRemoved));

    const onSpaceRenamed = () => this.#refreshSpaces();
    this.#client.on('spaceRenamed', onSpaceRenamed);
    this.#unsubscribers.push(() => this.#client.off('spaceRenamed', onSpaceRenamed));

    const onUserStorageChanged = ({ key, value }: { key: string; value: unknown }) => {
      if (value === null || value === undefined) {
        const { [key]: _, ...rest } = this.userStorage;
        this.userStorage = rest;
      } else {
        this.userStorage = { ...this.userStorage, [key]: value };
      }
    };
    this.#client.on('userStorageChanged', onUserStorageChanged);
    this.#unsubscribers.push(() => this.#client.off('userStorageChanged', onUserStorageChanged));
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

  /**
   * Initialize the client. Call on app startup.
   * Returns true if authenticated, false otherwise.
   */
  async init(): Promise<boolean> {
    this.authenticated = await this.#client.initialize();
    if (this.authenticated) {
      // Populate reactive state from SDK (now fresh from server)
      this.currentUser = this.#client.currentUser;
      this.userStorage = this.#client.getAllUserStorage();
      await this.#refreshSpaces();
    }
    return this.authenticated;
  }

  /**
   * Redirect to login page.
   */
  login(appName: string): void {
    this.#client.login(appName);
  }

  /**
   * Log out and close all open spaces.
   */
  logout(): void {
    for (const space of this.#openSpaces) {
      space.close();
    }
    this.#openSpaces.clear();
    this.#client.logout();
  }

  /**
   * Open an existing space. Returns a ReactiveSpace with reactive `interactions`.
   */
  async openSpace(id: string, options?: { conversationId?: string }): Promise<ReactiveSpace> {
    const space = await this.#client.openSpace(id, options);
    const reactiveSpace = wrapSpace(space);
    this.#openSpaces.add(reactiveSpace);
    return reactiveSpace;
  }

  /**
   * Create a new space. Returns a ReactiveSpace with reactive `interactions`.
   */
  async createSpace(name?: string, options?: { conversationId?: string }): Promise<ReactiveSpace> {
    const space = await this.#client.createSpace(name, options);
    const reactiveSpace = wrapSpace(space);
    this.#openSpaces.add(reactiveSpace);
    return reactiveSpace;
  }

  /**
   * Manually refresh the spaces list.
   */
  refreshSpaces(): Promise<void> {
    return this.#refreshSpaces();
  }

  /**
   * Delete a space.
   */
  deleteSpace(spaceId: string): Promise<void> {
    return this.#client.deleteSpace(spaceId);
  }

  /**
   * Set a value in user storage.
   * Updates reactive state immediately, then syncs to server.
   */
  setUserStorage(key: string, value: unknown): void {
    this.#client.setUserStorage(key, value);
    // Reactive state updated via userStorageChanged event
  }

  /**
   * Search for a user by email.
   */
  searchUser(email: string) {
    return this.#client.searchUser(email);
  }

  /**
   * Import a space from a zip archive.
   * Returns a ReactiveSpace with reactive `interactions`.
   */
  async importArchive(
    name: string,
    archive: Blob,
    options?: { conversationId?: string }
  ): Promise<ReactiveSpace> {
    const space = await this.#client.importArchive(name, archive, options);
    const reactiveSpace = wrapSpace(space);
    this.#openSpaces.add(reactiveSpace);
    return reactiveSpace;
  }

  /**
   * Get auth user info from JWT token.
   */
  get authUser() {
    return this.#client.getAuthUser();
  }

  /**
   * Get current user profile from server.
   */
  getCurrentUser() {
    return this.#client.getCurrentUser();
  }

  /**
   * Clean up resources.
   */
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
export function createRool(config?: RoolClientConfig): Rool {
  return new RoolImpl(config);
}

/**
 * Generate a unique 6-character alphanumeric ID.
 */
export function generateId(): string {
  return RoolClient.generateId();
}

export type Rool = RoolImpl;
