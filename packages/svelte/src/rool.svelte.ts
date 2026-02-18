import { RoolClient, type RoolSpaceInfo, type ConnectionState } from '@rool-dev/sdk';
import { wrapSpace, type ReactiveSpace } from './space.svelte.js';

/**
 * Rool client with reactive state for Svelte 5.
 *
 * Provides:
 * - Reactive auth state (`authenticated`)
 * - Reactive spaces list (`spaces`)
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

    const onSpaceAdded = () => this.#refreshSpaces();
    this.#client.on('spaceAdded', onSpaceAdded);
    this.#unsubscribers.push(() => this.#client.off('spaceAdded', onSpaceAdded));

    const onSpaceRemoved = () => this.#refreshSpaces();
    this.#client.on('spaceRemoved', onSpaceRemoved);
    this.#unsubscribers.push(() => this.#client.off('spaceRemoved', onSpaceRemoved));

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

  /**
   * Initialize the client. Call on app startup.
   * Returns true if authenticated, false otherwise.
   */
  async init(): Promise<boolean> {
    this.authenticated = await this.#client.initialize();
    if (this.authenticated) {
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
export function createRool(): Rool {
  return new RoolImpl();
}

/**
 * Generate a unique 6-character alphanumeric ID.
 */
export function generateId(): string {
  return RoolClient.generateId();
}

export type Rool = RoolImpl;
