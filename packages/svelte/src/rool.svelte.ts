import { RoolClient, type RoolSpaceInfo, type ConnectionState, type RoolClientConfig, type CurrentUser } from '@rool-dev/sdk';
import { createChannelList, type ReactiveChannelList } from './channel.svelte.js';
import { wrapSpace, type ReactiveSpace } from './space.svelte.js';

/**
 * Rool client with reactive state for Svelte 5.
 *
 * Provides:
 * - Reactive auth state (`authenticated`)
 * - Reactive spaces list (`spaces`)
 * - Reactive user storage (`userStorage`)
 * - Channel-based access to spaces
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

  /**
   * Access the underlying RoolClient for low-level API calls
   * (e.g., graphql(), fetch()) not covered by the reactive wrapper.
   */
  get client(): RoolClient {
    return this.#client;
  }

  #setupEventListeners() {
    const onAuthStateChanged = (auth: boolean) => {
      this.authenticated = auth;
      if (auth) {
        this.#refreshSpaces();
      } else {
        // currentUser/userStorage clear via currentUserChanged(null)
        this.spaces = undefined;
      }
    };
    this.#client.on('authStateChanged', onAuthStateChanged);
    this.#unsubscribers.push(() => this.#client.off('authStateChanged', onAuthStateChanged));

    const onCurrentUserChanged = (user: CurrentUser | null) => {
      this.currentUser = user;
      this.userStorage = this.#client.getAllUserStorage();
    };
    this.#client.on('currentUserChanged', onCurrentUserChanged);
    this.#unsubscribers.push(() => this.#client.off('currentUserChanged', onCurrentUserChanged));

    const onConnectionStateChanged = (state: ConnectionState) => {
      this.connectionState = state;
      // Re-fetch spaces on (re)connect: an offline boot leaves the list in an
      // error state, and a long outage may have dropped space events.
      if (state === 'connected' && this.authenticated) {
        this.#refreshSpaces();
      }
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
    try {
      this.authenticated = await this.#client.initialize();
    } catch {
      // initialize() handles transient outages internally, so a throw here is
      // unexpected. Don't bounce a credentialed user to login — fall back to a
      // credential check (no network) and stay authenticated if we hold tokens.
      this.authenticated = await this.#client.isAuthenticated();
    }
    if (this.authenticated) {
      // currentUser/userStorage are mirrored by the currentUserChanged listener
      // (during initialize(), or after reconnect on an offline boot).
      await this.#refreshSpaces();
    }
    return this.authenticated ?? false;
  }

  /**
   * Redirect to login page.
   */
  login(appName: string, params?: Record<string, string>): void {
    this.#client.login(appName, params);
  }

  /**
   * Redirect to signup page.
   */
  signup(appName: string, params?: Record<string, string>): void {
    this.#client.signup(appName, params);
  }

  /**
   * Complete an email verification flow using a token from the verification
   * email link. Signs the user in without a redirect on success. Intended
   * to be called when the app detects `?verify=<token>` on load.
   */
  async verify(token: string): Promise<boolean> {
    // Reactive state is mirrored by the currentUserChanged and authStateChanged
    // listeners during the client's verify/hydration.
    return this.#client.verify(token);
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
   * Open a space with a live SSE subscription. Returns a ReactiveSpace.
   * Call `space.openChannel(channelId)` to get a ReactiveChannel.
   * Call `space.close()` when done to stop the subscription.
   */
  async openSpace(spaceId: string): Promise<ReactiveSpace> {
    const raw = await this.#client.openSpace(spaceId);
    const reactive = wrapSpace(raw);
    this.#openSpaces.add(reactive);
    return reactive;
  }

  /**
   * Create a new space. Returns a ReactiveSpace.
   */
  async createSpace(name: string): Promise<ReactiveSpace> {
    const raw = await this.#client.createSpace(name);
    const reactive = wrapSpace(raw);
    this.#openSpaces.add(reactive);
    return reactive;
  }

  /**
   * Duplicate an existing space. Returns a ReactiveSpace.
   */
  async duplicateSpace(sourceSpaceId: string, name: string): Promise<ReactiveSpace> {
    const raw = await this.#client.duplicateSpace(sourceSpaceId, name);
    const reactive = wrapSpace(raw);
    this.#openSpaces.add(reactive);
    return reactive;
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
   * Mark the current user for deletion, then log out locally.
   */
  deleteCurrentUser(): Promise<void> {
    return this.#client.deleteCurrentUser();
  }

  /**
   * Set or change the current user's password.
   */
  setPassword(password: string): Promise<void> {
    return this.#client.setPassword(password);
  }

  /**
   * Get a value from user storage.
   */
  getUserStorage<T = unknown>(key: string): T | undefined {
    return this.#client.getUserStorage<T>(key);
  }

  /**
   * Get all user storage data.
   */
  getAllUserStorage(): Record<string, unknown> {
    return this.#client.getAllUserStorage();
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
   * Report an authenticated telemetry event.
   * Fire-and-forget; errors are logged by the underlying client.
   */
  reportEvent(event: string, url?: string): void {
    this.#client.reportEvent(event, url);
  }

  /**
   * Look up an invite link by its token, without redeeming it.
   */
  previewInvite(token: string) {
    return this.#client.previewInvite(token);
  }

  /**
   * Redeem an invite link, joining the space it belongs to.
   * The reactive `spaces` list includes the joined space when this resolves;
   * the server's space_access_changed push also lands, but is not awaited.
   */
  async redeemInvite(token: string) {
    const result = await this.#client.redeemInvite(token);
    await this.#refreshSpaces();
    return result;
  }

  /**
   * Import a space from a zip archive. Returns a ReactiveSpace.
   */
  async importArchive(name: string, archive: Blob): Promise<ReactiveSpace> {
    const raw = await this.#client.importArchive(name, archive);
    const reactive = wrapSpace(raw);
    this.#openSpaces.add(reactive);
    return reactive;
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
  async getCurrentUser() {
    const user = await this.#client.getCurrentUser();
    this.currentUser = user;
    return user;
  }

  /**
   * Update the current user's profile (name, slug).
   */
  async updateCurrentUser(input: { name?: string; slug?: string; marketingOptIn?: boolean }) {
    const user = await this.#client.updateCurrentUser(input);
    this.currentUser = user;
    return user;
  }


  /**
   * Create a reactive channel list for a space.
   * Auto-updates when channels are created, updated, or deleted.
   * Returns immediately with loading=true; populates once the space is ready.
   * Call close() when done to stop listening.
   */
  channels(spaceId: string): ReactiveChannelList {
    return createChannelList(this.#client.openSpace(spaceId));
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
