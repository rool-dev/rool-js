import { RoolClient, type RoolSpace, type RoolSpaceInfo, type ConnectionState, type RoolClientConfig, type CurrentUser, type FindExtensionsOptions, type ExtensionInfo, type PublishedExtensionInfo, type UploadExtensionOptions } from '@rool-dev/sdk';
import { wrapChannel, createChannelList, type ReactiveChannel, type ReactiveChannelList } from './channel.svelte.js';

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
  #openChannels: Set<ReactiveChannel> = new Set();

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
    try {
      this.authenticated = await this.#client.initialize();
    } catch {
      this.authenticated = false;
      return false;
    }
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
    const ok = await this.#client.verify(token);
    if (ok) {
      // Client has already hydrated currentUser, storage, and subscriptions.
      // Mirror that state into our reactive fields — spaces refresh is
      // triggered by the authStateChanged event, which also updates
      // `authenticated`.
      this.currentUser = this.#client.currentUser;
      this.userStorage = this.#client.getAllUserStorage();
    }
    return ok;
  }

  /**
   * Log out and close all open channels.
   */
  logout(): void {
    for (const channel of this.#openChannels) {
      channel.close();
    }
    this.#openChannels.clear();
    this.#client.logout();
  }

  /**
   * Open a channel (space + channelId pair).
   * Returns a ReactiveChannel with reactive `interactions`.
   */
  async openChannel(spaceId: string, channelId: string): Promise<ReactiveChannel> {
    const channel = await this.#client.openChannel(spaceId, channelId);
    const reactiveChannel = wrapChannel(channel);
    this.#openChannels.add(reactiveChannel);
    return reactiveChannel;
  }

  /**
   * Open a space for admin operations.
   * Returns a lightweight RoolSpace handle (not reactive).
   */
  openSpace(spaceId: string): Promise<RoolSpace> {
    return this.#client.openSpace(spaceId);
  }

  /**
   * Create a new space.
   * Returns a lightweight RoolSpace handle (not reactive).
   */
  createSpace(name: string): Promise<RoolSpace> {
    return this.#client.createSpace(name);
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
   * Returns a lightweight RoolSpace handle (not reactive).
   */
  importArchive(name: string, archive: Blob): Promise<RoolSpace> {
    return this.#client.importArchive(name, archive);
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
  async updateCurrentUser(input: { name?: string; slug?: string }) {
    const user = await this.#client.updateCurrentUser(input);
    this.currentUser = user;
    return user;
  }

  /**
   * Rename a channel in a space.
   */
  renameChannel(spaceId: string, channelId: string, name: string): Promise<void> {
    return this.#client.renameChannel(spaceId, channelId, name);
  }

  /**
   * Delete a channel from a space.
   */
  deleteChannel(spaceId: string, channelId: string): Promise<void> {
    return this.#client.deleteChannel(spaceId, channelId);
  }

  /**
   * Install an extension into a space.
   * Creates/updates a channel with the extension's manifest settings.
   * Returns the channel ID.
   */
  // --- User Extensions (your personal library) ---

  /** Upload or update a user extension bundle. */
  uploadExtension(extensionId: string, options: UploadExtensionOptions): Promise<ExtensionInfo> {
    return this.#client.uploadExtension(extensionId, options);
  }

  /** Delete a user extension permanently. */
  deleteExtension(extensionId: string): Promise<void> {
    return this.#client.deleteExtension(extensionId);
  }

  /** List the current user's extensions. */
  listExtensions(): Promise<ExtensionInfo[]> {
    return this.#client.listExtensions();
  }

  /** Get info for a specific user extension. */
  getExtensionInfo(extensionId: string): Promise<ExtensionInfo | null> {
    return this.#client.getExtensionInfo(extensionId);
  }

  // --- Published Extensions (public discovery & install) ---

  /** Search published extensions. */
  findExtensions(options?: FindExtensionsOptions): Promise<PublishedExtensionInfo[]> {
    return this.#client.findExtensions(options);
  }

  /** Install an extension into a space. */
  installExtension(spaceId: string, extensionId: string, channelId: string): Promise<string> {
    return this.#client.installExtension(spaceId, extensionId, channelId);
  }

  /** Publish a user extension (make it publicly discoverable). */
  publishToPublic(extensionId: string): Promise<void> {
    return this.#client.publishToPublic(extensionId);
  }

  /** Unpublish an extension (remove from public listing). */
  unpublishFromPublic(extensionId: string): Promise<void> {
    return this.#client.unpublishFromPublic(extensionId);
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
    for (const channel of this.#openChannels) {
      channel.close();
    }
    this.#openChannels.clear();

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
