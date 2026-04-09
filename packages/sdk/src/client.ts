// =============================================================================
// Rool Client
// =============================================================================

import { EventEmitter } from './event-emitter.js';
import { AuthManager } from './auth.js';
import { GraphQLClient } from './graphql.js';
import { ClientSubscriptionManager } from './subscription.js';
import { MediaClient } from './media.js';
import { ExtensionsClient } from './apps.js';
import { RoolChannel, generateEntityId } from './channel.js';
import { RoolSpace } from './space.js';
import { defaultLogger, type Logger } from './logger.js';
import type {
  RoolClientConfig,
  RoolClientEvents,
  RoolSpaceInfo,
  RoolUserRole,
  LinkAccess,
  ClientEvent,
  CurrentUser,
  UserResult,
  AuthUser,
  ConnectionState,
  PublishedExtensionInfo,
  PublishExtensionOptions,
  FindExtensionsOptions,
} from './types.js';

type ResolvedUrls = {
  graphql: string;
  media: string;
  auth: string;
  extensions: string;
};

/**
 * Rool Client - Manages authentication, space lifecycle, and shared infrastructure.
 *
 * The client is lightweight - most operations happen on RoolChannel instances.
 *
 * Features:
 * - Authentication (login, logout, token management)
 * - Space lifecycle (list, create, delete, rename)
 * - Channel management (open, list, rename, delete)
 * - Client-level subscription for lifecycle events
 * - User storage (cross-device key-value storage)
 */
export class RoolClient extends EventEmitter<RoolClientEvents> {
  private baseUrl: string;
  private urls: ResolvedUrls;
  private authManager: AuthManager;
  private graphqlClient: GraphQLClient;
  private subscriptionManager: ClientSubscriptionManager | null = null;
  private logger: Logger;

  // Registry of open channels (for cleanup on logout/destroy)
  private openChannels = new Map<string, RoolChannel>();

  // User storage cache (synced to localStorage)
  private _storageCache: Record<string, unknown> = {};

  // Current user (fetched during initialize)
  private _currentUser: CurrentUser | null = null;

  constructor(config: RoolClientConfig = {}) {
    super();

    this.logger = config.logger ?? defaultLogger;
    this._emitterLogger = this.logger;

    this.baseUrl = (config.baseUrl ?? 'https://api.rool.dev').replace(/\/+$/, ''); // Remove trailing slashes
    this.urls = {
      graphql: config.graphqlUrl ?? `${this.baseUrl}/graphql`,
      media: config.mediaUrl ?? `${this.baseUrl}/media`,
      auth: config.authUrl ?? `${this.baseUrl}/auth`,
      extensions: `${this.baseUrl}/user-extensions`,
    };

    this.authManager = new AuthManager({
      authUrl: this.urls.auth,
      authProvider: config.authProvider,
      logger: this.logger,
      onAuthStateChanged: (authenticated) => {
        this.emit('authStateChanged', authenticated);
      },
    });

    this.graphqlClient = new GraphQLClient({
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
    });

    // Load storage cache from localStorage
    this.loadStorageCache();
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the client - should be called on app startup.
   * Processes any auth callback in the URL, sets up auto-refresh,
   * and starts real-time event subscription if authenticated.
   * @returns true if authenticated, false otherwise
   */
  async initialize(): Promise<boolean> {
    this.authManager.initialize();
    const authenticated = await this.isAuthenticated();
    if (authenticated) {
      const user = await this.getCurrentUser();
      this._currentUser = user;
      this._storageCache = user.storage ?? {};
      this.saveStorageCache();
      await this.ensureSubscribed();
    }
    return authenticated;
  }

  /**
   * Clean up resources - call when destroying the client.
   */
  destroy(): void {
    this.authManager.destroy();
    this.subscriptionManager?.destroy();

    // Close all open channels
    for (const channel of this.openChannels.values()) {
      channel.close();
    }
    this.openChannels.clear();

    this.removeAllListeners();
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Initiate login by redirecting to auth page.
   * @param appName - The name of the application requesting login (displayed on auth page)
   */
  async login(appName: string, params?: Record<string, string>): Promise<void> {
    return this.authManager.login(appName, params);
  }

  /**
   * Initiate signup by redirecting to auth page.
   * @param appName - The name of the application requesting signup (displayed on auth page)
   * @param params - Optional additional query parameters to pass to the auth server
   */
  async signup(appName: string, params?: Record<string, string>): Promise<void> {
    return this.authManager.signup(appName, params);
  }

  /**
   * Logout - clear all tokens and state.
   */
  logout(): void {
    this.authManager.logout();
    this.unsubscribe();

    // Close all open channels
    for (const channel of this.openChannels.values()) {
      channel.close();
    }
    this.openChannels.clear();
  }

  /**
   * Process auth callback from URL fragment.
   * Called automatically by initialize(), but can be called manually.
   */
  processAuthCallback(): boolean {
    return this.authManager.processCallback();
  }

  /**
   * Check if user is currently authenticated (validates token is usable).
   */
  async isAuthenticated(): Promise<boolean> {
    return this.authManager.isAuthenticated();
  }

  /**
   * Make an authenticated fetch request to the Rool API.
   * @internal Not part of the public API — use typed methods instead.
   *
   * @param path - Path relative to the base URL (e.g., '/billing/usage')
   * @param init - Standard fetch RequestInit options. Authorization header is added automatically.
   */
  async _api(path: string, init?: RequestInit): Promise<Response> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    headers.set('X-Rool-Token', tokens.roolToken);

    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  /**
   * Get auth identity decoded from JWT token.
   * For the Rool user (with server-assigned id), use currentUser.
   */
  getAuthUser(): AuthUser {
    return this.authManager.getAuthUser();
  }

  /**
   * Get the current Rool user (cached from initialize).
   * Available after successful authentication.
   */
  get currentUser(): CurrentUser | null {
    return this._currentUser;
  }

  // ===========================================================================
  // Space Lifecycle
  // ===========================================================================

  /**
   * List all spaces accessible to the user.
   */
  async listSpaces(): Promise<RoolSpaceInfo[]> {
    return this.graphqlClient.listSpaces();
  }

  /**
   * Open a channel (space + channelId pair).
   * Loads the space data from the server and returns a RoolChannel instance.
   * The channel manages its own real-time subscription.
   * If the channel doesn't exist, the server creates it.
   *
   * @param spaceId - The ID of the space
   * @param channelId - The channel ID
   */
  async openChannel(spaceId: string, channelId: string): Promise<RoolChannel> {
    if (!channelId || channelId.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(channelId)) {
      throw new Error('channelId must be 1–32 characters containing only alphanumeric characters, hyphens, and underscores');
    }

    // Ensure client subscription is active (for lifecycle events)
    void this.ensureSubscribed();

    const result = await this.graphqlClient.openChannel(spaceId, channelId);

    const channel = new RoolChannel({
      id: spaceId,
      name: result.name,
      role: result.role as RoolUserRole,
      linkAccess: result.linkAccess,
      userId: result.userId,
      objectIds: result.objectIds,
      objectStats: result.objectStats,
      schema: result.schema,
      meta: result.meta,
      channel: result.channel,
      channelId,
      graphqlClient: this.graphqlClient,
      mediaClient: this.mediaClient,
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
      logger: this.logger,
      onClose: () => this.unregisterChannel(spaceId, channelId),
    });

    // Wait for real-time subscription before returning
    await channel._waitForSubscription();

    // Register for cleanup
    this.registerChannel(spaceId, channelId, channel);

    return channel;
  }

  /**
   * Open a space for admin operations.
   * Returns a lightweight handle for user management, link access,
   * channel management, and export. Does not start a real-time subscription.
   *
   * To work with objects and AI, call space.openChannel(channelId).
   */
  async openSpace(spaceId: string): Promise<RoolSpace> {
    const { name, role, linkAccess, memberCount, channels } = await this.graphqlClient.openSpace(spaceId);

    return new RoolSpace({
      id: spaceId,
      name,
      role: role as RoolUserRole,
      linkAccess,
      memberCount,
      channels,
      graphqlClient: this.graphqlClient,
      mediaClient: this.mediaClient,
      openChannelFn: (sid, cid) => this.openChannel(sid, cid),
    });
  }

  /**
   * Create a new space.
   * Returns a RoolSpace handle for admin operations.
   * Call space.openChannel(channelId) to start working with objects.
   */
  async createSpace(name: string): Promise<RoolSpace> {
    // Ensure client subscription is active (for lifecycle events)
    void this.ensureSubscribed();

    const { spaceId } = await this.graphqlClient.createSpace(name);

    return new RoolSpace({
      id: spaceId,
      name,
      role: 'owner',
      linkAccess: 'none',
      memberCount: 1,
      channels: [],
      graphqlClient: this.graphqlClient,
      mediaClient: this.mediaClient,
      openChannelFn: (sid, cid) => this.openChannel(sid, cid),
    });
  }

  /**
   * Rename a channel in a space.
   * Lightweight — single GraphQL mutation, no subscription needed.
   */
  async renameChannel(spaceId: string, channelId: string, name: string): Promise<void> {
    await this.graphqlClient.renameChannel(spaceId, channelId, name);
  }

  /**
   * Delete a channel from a space.
   * Lightweight — single GraphQL mutation, no subscription needed.
   */
  async deleteChannel(spaceId: string, channelId: string): Promise<void> {
    await this.graphqlClient.deleteChannel(spaceId, channelId);
  }

  /**
   * Delete a space.
   * Note: This does not affect any open Channel instances - they become stale.
   */
  async deleteSpace(spaceId: string): Promise<void> {
    await this.graphqlClient.deleteSpace(spaceId);
    // Client-level event will be emitted via SSE subscription
  }

  /**
   * Import a space from a zip archive.
   * Creates a new space with the given name and imports objects, relations, and media.
   * Returns a RoolSpace handle.
   */
  async importArchive(name: string, archive: Blob): Promise<RoolSpace> {
    // Ensure client subscription is active (for lifecycle events)
    void this.ensureSubscribed();

    // Import via REST endpoint (creates the space)
    const spaceId = await this.mediaClient.importArchive(name, archive);

    // Open the space to get its data
    return this.openSpace(spaceId);
  }

  // ===========================================================================
  // User Operations
  // ===========================================================================

  /**
   * Get the current Rool user from the server.
   * Returns the user's server-assigned id, email, plan, and credits.
   */
  async getCurrentUser(): Promise<CurrentUser> {
    const user = await this.graphqlClient.getCurrentUser();
    this._currentUser = user;
    return user;
  }

  /**
   * Search for a user by email.
   */
  async searchUser(email: string): Promise<UserResult | null> {
    return this.graphqlClient.searchUser(email);
  }

  /**
   * Update the current user's profile.
   * - name: display name
   * - slug: used in app publishing URLs (3-32 chars, start with letter, lowercase alphanumeric/hyphens/underscores)
   */
  async updateCurrentUser(input: { name?: string; slug?: string }): Promise<CurrentUser> {
    const user = await this.graphqlClient.updateCurrentUser(input);
    this._currentUser = user;
    return user;
  }

  // ===========================================================================
  // Extension Publishing
  // ===========================================================================

  // ===========================================================================
  // User Extensions (your personal library)
  // ===========================================================================

  /**
   * Upload or update a user extension bundle.
   * @param extensionId - URL-safe identifier (alphanumeric, hyphens, underscores)
   * @param options - Bundle zip file (must include index.html and manifest.json)
   */
  async uploadExtension(extensionId: string, options: PublishExtensionOptions): Promise<PublishedExtensionInfo> {
    return this.extensionsClient.upload(extensionId, options);
  }

  /** Delete a user extension permanently (removes files and DB row). */
  async deleteExtension(extensionId: string): Promise<void> {
    return this.extensionsClient.delete(extensionId);
  }

  /** List the current user's extensions. */
  async listExtensions(): Promise<PublishedExtensionInfo[]> {
    return this.extensionsClient.list();
  }

  /** Get info for a specific user extension. Returns null if not found. */
  async getExtensionInfo(extensionId: string): Promise<PublishedExtensionInfo | null> {
    return this.extensionsClient.get(extensionId);
  }

  // ===========================================================================
  // Published Extensions (public discovery & install)
  // ===========================================================================

  /**
   * Search published extensions. With a query, performs semantic search.
   * Without a query, returns all published extensions sorted by most recently updated.
   */
  async findExtensions(options?: FindExtensionsOptions): Promise<PublishedExtensionInfo[]> {
    return this.graphqlClient.findExtensions(options);
  }

  /**
   * Install an extension into a space.
   * If extensionId is a user extension you own, wires it directly.
   * If it's a published extension, copies source and builds a new user extension.
   * @returns The channel ID
   */
  async installExtension(spaceId: string, extensionId: string, channelId: string): Promise<string> {
    return this.graphqlClient.installExtension(spaceId, extensionId, channelId);
  }

  /** Publish a user extension (make it publicly discoverable). */
  async publishToPublic(extensionId: string): Promise<void> {
    return this.graphqlClient.publishExtensionToPublic(extensionId);
  }

  /** Unpublish an extension (remove from public listing). */
  async unpublishFromPublic(extensionId: string): Promise<void> {
    return this.graphqlClient.unpublishExtensionFromPublic(extensionId);
  }

  // ===========================================================================
  // User Storage (server-side localStorage equivalent)
  // ===========================================================================

  /**
   * Get a value from user storage (sync read from local cache).
   * Returns undefined if key doesn't exist.
   */
  getUserStorage<T = unknown>(key: string): T | undefined {
    return this._storageCache[key] as T | undefined;
  }

  /**
   * Set a value in user storage.
   * Updates local cache immediately, then syncs to server.
   * Pass undefined/null to delete the key.
   * Storage is limited to 10MB total.
   */
  setUserStorage(key: string, value: unknown): void {
    // Update local cache
    if (value === null || value === undefined) {
      delete this._storageCache[key];
    } else {
      this._storageCache[key] = value;
    }

    // Persist to localStorage
    this.saveStorageCache();

    // Emit event (local source)
    this.emit('userStorageChanged', { key, value: value ?? null, source: 'local' });

    // Fire-and-forget server sync
    this.graphqlClient.setUserStorage(key, value).catch((error) => {
      this.logger.error('[RoolClient] Failed to sync user storage:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)), 'userStorage');
    });
  }

  /**
   * Get all user storage data (sync read from local cache).
   */
  getAllUserStorage(): Record<string, unknown> {
    return { ...this._storageCache };
  }

  // ===========================================================================
  // Media Client (used internally by Space instances)
  // ===========================================================================

  private get mediaClient(): MediaClient {
    return new MediaClient({
      mediaUrl: this.urls.media,
      backendOrigin: new URL(this.urls.media).origin,
      authManager: this.authManager,
    });
  }

  // ===========================================================================
  // Extensions Client (used for extension publishing)
  // ===========================================================================

  private get extensionsClient(): ExtensionsClient {
    return new ExtensionsClient({
      extensionsUrl: this.urls.extensions,
      authManager: this.authManager,
    });
  }

  // ===========================================================================
  // Subscriptions (internal - auto-managed)
  // ===========================================================================

  /**
   * Ensure the client-level event subscription is active.
   * Called automatically when opening spaces.
   * Also fetches and caches the current user ID.
   * @internal
   */
  private async ensureSubscribed(): Promise<void> {
    if (this.subscriptionManager) return;

    this.subscriptionManager = new ClientSubscriptionManager({
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
      logger: this.logger,
      onEvent: (event) => this.handleClientEvent(event),
      onConnectionStateChanged: (state: ConnectionState) => {
        this.emit('connectionStateChanged', state);
      },
      onError: (error) => {
        this.emit('error', error, 'subscription');
      },
    });

    await this.subscriptionManager.subscribe();
  }

  /**
   * Disconnect from real-time events.
   * @internal
   */
  private unsubscribe(): void {
    if (this.subscriptionManager) {
      this.subscriptionManager.destroy();
      this.subscriptionManager = null;
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Generate a unique entity ID.
   * 6-character alphanumeric string (62^6 = 56.8 billion possible values).
   * Also available as top-level generateEntityId() export.
   */
  static generateId(): string {
    return generateEntityId();
  }

  /**
   * Execute an arbitrary GraphQL query or mutation.
   * @internal Not part of the public API — use typed methods instead.
   */
  async _graphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return this.graphqlClient.query<T>(query, variables);
  }

  // ===========================================================================
  // Private Methods - Channel Registry
  // ===========================================================================

  private registerChannel(spaceId: string, channelId: string, channel: RoolChannel): void {
    this.openChannels.set(`${spaceId}:${channelId}`, channel);
  }

  private unregisterChannel(spaceId: string, channelId: string): void {
    this.openChannels.delete(`${spaceId}:${channelId}`);
  }

  // ===========================================================================
  // Private Methods - Event Handling
  // ===========================================================================

  /**
   * Handle a client-level event from the subscription.
   * @internal
   */
  private handleClientEvent(event: ClientEvent): void {
    switch (event.type) {
      case 'space_created':
        this.emit('spaceAdded', {
          id: event.spaceId,
          name: event.name,
          role: (event.role as RoolUserRole) ?? 'owner',
          ownerId: event.ownerId ?? '',
          size: event.size ?? 0,
          createdAt: event.createdAt ?? new Date().toISOString(),
          updatedAt: event.updatedAt ?? new Date().toISOString(),
          linkAccess: 'none', // New spaces default to no link access
          memberCount: 1, // Creator is the only member
        });
        break;

      case 'space_deleted':
        this.emit('spaceRemoved', event.spaceId);
        break;

      case 'space_renamed':
        this.emit('spaceRenamed', event.spaceId, event.name);
        break;

      case 'space_access_changed':
        if (event.role === 'none') {
          this.emit('spaceRemoved', event.spaceId);
        } else {
          this.emit('spaceAdded', {
            id: event.spaceId,
            name: event.name,
            role: event.role as RoolUserRole,
            ownerId: event.ownerId,
            size: event.size,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            linkAccess: event.linkAccess as LinkAccess,
            memberCount: event.memberCount,
          });
        }
        break;

      case 'user_storage_changed':
        this.handleUserStorageChanged(event.key, event.value);
        break;

      case 'channel_created':
        this.emit('channelCreated', event.spaceId, {
          id: event.channelId,
          name: event.name ?? null,
          createdAt: event.channelCreatedAt ?? Date.now(),
          createdBy: event.channelCreatedBy ?? '',
          createdByName: event.channelCreatedByName ?? null,
          interactionCount: 0,
          extensionUrl: event.channelExtensionUrl ?? null,
          extensionId: event.channelExtensionId ?? null,
        });
        break;

      case 'channel_renamed':
        this.emit('channelRenamed', event.spaceId, event.channelId, event.name);
        break;

      case 'channel_deleted':
        this.emit('channelDeleted', event.spaceId, event.channelId);
        break;
    }
  }

  // ===========================================================================
  // Private Methods - User Storage Cache
  // ===========================================================================

  /**
   * Load storage cache from auth provider.
   * @internal
   */
  private loadStorageCache(): void {
    const cached = this.authManager.getStorage();
    if (cached) {
      this._storageCache = cached;
    }
  }

  /**
   * Save storage cache via auth provider.
   * @internal
   */
  private saveStorageCache(): void {
    this.authManager.setStorage(this._storageCache);
  }

  /**
   * Handle a user storage change from SSE (remote update).
   * Updates cache and emits event if value actually changed.
   * @internal
   */
  private handleUserStorageChanged(key: string, value: unknown): void {
    const currentValue = this._storageCache[key];

    // Only update and emit if value actually changed
    if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
      if (value === null || value === undefined) {
        delete this._storageCache[key];
      } else {
        this._storageCache[key] = value;
      }

      this.saveStorageCache();
      this.emit('userStorageChanged', { key, value: value ?? null, source: 'remote' });
    }
  }
}
