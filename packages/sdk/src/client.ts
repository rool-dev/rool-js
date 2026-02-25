// =============================================================================
// Rool Client
// =============================================================================

import { EventEmitter } from './event-emitter.js';
import { AuthManager } from './auth.js';
import { GraphQLClient } from './graphql.js';
import { ClientSubscriptionManager } from './subscription.js';
import { MediaClient } from './media.js';
import { AppsClient } from './apps.js';
import { RoolSpace, generateEntityId } from './space.js';
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
  PublishedAppInfo,
  PublishAppOptions,
} from './types.js';

type ResolvedUrls = {
  graphql: string;
  media: string;
  auth: string;
  apps: string;
};

/**
 * Rool Client - Manages authentication, space lifecycle, and shared infrastructure.
 *
 * The client is lightweight - most operations happen on Space instances
 *
 * Features:
 * - Authentication (login, logout, token management)
 * - Spaces lifecycle (list, open, create, delete)
 * - Client-level subscription for lifecycle events
 * - Media operations
 * - AI operations (prompt, image generation)
 */
export class RoolClient extends EventEmitter<RoolClientEvents> {
  private baseUrl: string;
  private urls: ResolvedUrls;
  private authManager: AuthManager;
  private graphqlClient: GraphQLClient;
  private subscriptionManager: ClientSubscriptionManager | null = null;
  private logger: Logger;

  // Registry of open spaces (for cleanup on logout/destroy)
  private openSpaces = new Map<string, RoolSpace>();

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
      apps: `${this.baseUrl}/apps`,
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
      // Sync storage from server (replaces potentially stale localStorage cache)
      try {
        const user = await this.getCurrentUser();
        this._currentUser = user;
        this._storageCache = user.storage ?? {};
        this.saveStorageCache();
      } catch (error) {
        // Non-fatal: proceed with cached storage, SSE will sync changes
        this.logger.warn('[RoolClient] Failed to sync user storage:', error);
      }
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

    // Close all open spaces
    for (const space of this.openSpaces.values()) {
      space.close();
    }
    this.openSpaces.clear();

    this.removeAllListeners();
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Initiate login by redirecting to auth page.
   * @param appName - The name of the application requesting login (displayed on auth page)
   */
  async login(appName: string): Promise<void> {
    return this.authManager.login(appName);
  }

  /**
   * Logout - clear all tokens and state.
   */
  logout(): void {
    this.authManager.logout();
    this.unsubscribe();

    // Close all open spaces
    for (const space of this.openSpaces.values()) {
      space.close();
    }
    this.openSpaces.clear();
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
   * Use this escape hatch for app-specific endpoints not covered by the typed API.
   *
   * @param path - Path relative to the base URL (e.g., '/billing/usage')
   * @param init - Standard fetch RequestInit options. Authorization header is added automatically.
   */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
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
   * Open an existing space.
   * Loads the space data from the server and returns a Space instance.
   * The space manages its own real-time subscription.
   * 
   * @param spaceId - The ID of the space to open
   * @param options.conversationId - Optional conversation ID for AI context continuity. If not provided, a new conversation is created.
   */
  async openSpace(spaceId: string, options?: { conversationId?: string }): Promise<RoolSpace> {
    // Ensure client subscription is active (for lifecycle events)
    void this.ensureSubscribed();

    const { data, name, role, userId, linkAccess } = await this.graphqlClient.getSpace(spaceId);

    const space = new RoolSpace({
      id: spaceId,
      name,
      role: role as RoolUserRole,
      linkAccess,
      userId,
      initialData: data,
      conversationId: options?.conversationId,
      graphqlClient: this.graphqlClient,
      mediaClient: this.mediaClient,
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
      logger: this.logger,
      onClose: (id) => this.unregisterSpace(id),
    });

    // Wait for real-time subscription before returning
    await space._waitForSubscription();

    // Register for cleanup
    this.registerSpace(spaceId, space);

    return space;
  }

  /**
   * Create a new space.
   * Creates on server and returns a Space instance.
   * The space manages its own real-time subscription.
   * 
   * @param name - Optional name for the space
   * @param options.conversationId - Optional conversation ID for AI context continuity. If not provided, a new conversation is created.
   */
  async createSpace(name?: string, options?: { conversationId?: string }): Promise<RoolSpace> {
    // Ensure client subscription is active (for lifecycle events)
    void this.ensureSubscribed();

    // Server generates the ID and returns full space data
    const { spaceId, data, name: spaceName, userId } = await this.graphqlClient.createSpace(name ?? 'Untitled');

    const space = new RoolSpace({
      id: spaceId,
      name: spaceName,
      role: 'owner',
      linkAccess: 'none', // New spaces default to no link access
      userId,
      initialData: data,
      conversationId: options?.conversationId,
      graphqlClient: this.graphqlClient,
      mediaClient: this.mediaClient,
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
      logger: this.logger,
      onClose: (id) => this.unregisterSpace(id),
    });

    // Wait for real-time subscription before returning
    await space._waitForSubscription();

    // Register for cleanup
    this.registerSpace(spaceId, space);

    return space;
  }

  /**
   * Delete a space.
   * Note: This does not affect any open Space instances - they become stale.
   */
  async deleteSpace(spaceId: string): Promise<void> {
    await this.graphqlClient.deleteSpace(spaceId);
    // Client-level event will be emitted via SSE subscription
  }

  /**
   * Import a space from a zip archive.
   * Creates a new space with the given name and imports objects, relations, and media.
   * Returns the opened RoolSpace instance.
   *
   * @param name - Name for the imported space
   * @param archive - Zip archive blob (from exportArchive or file upload)
   * @param options.conversationId - Optional conversation ID for AI context continuity
   */
  async importArchive(
    name: string,
    archive: Blob,
    options?: { conversationId?: string }
  ): Promise<RoolSpace> {
    // Ensure client subscription is active (for lifecycle events)
    void this.ensureSubscribed();

    // Import via REST endpoint (creates the space)
    const spaceId = await this.mediaClient.importArchive(name, archive);

    // Open the newly created space
    return this.openSpace(spaceId, options);
  }

  // ===========================================================================
  // User Operations
  // ===========================================================================

  /**
   * Get the current Rool user from the server.
   * Returns the user's server-assigned id, email, plan, and credits.
   */
  async getCurrentUser(): Promise<CurrentUser> {
    const user = await this.graphqlClient.getAccount();
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
   * Set the current user's slug (used in app publishing URLs).
   * Slug must be 3-32 characters, start with a letter, and contain only
   * lowercase letters, numbers, hyphens, and underscores.
   * Cannot be changed if the user has published apps.
   */
  async setSlug(slug: string): Promise<void> {
    return this.graphqlClient.setSlug(slug);
  }

  // ===========================================================================
  // App Publishing
  // ===========================================================================

  /**
   * Publish an app. The app will be accessible at:
   * https://use.rool.app/{appId}/
   *
   * @param appId - URL-safe identifier (alphanumeric, hyphens, underscores)
   * @param options - App name, bundle (zip file), and optional SPA flag
   */
  async publishApp(appId: string, options: PublishAppOptions): Promise<PublishedAppInfo> {
    return this.appsClient.publish(appId, options);
  }

  /**
   * Unpublish an app.
   */
  async unpublishApp(appId: string): Promise<void> {
    return this.appsClient.unpublish(appId);
  }

  /**
   * List all published apps for the current user.
   */
  async listApps(): Promise<PublishedAppInfo[]> {
    return this.appsClient.list();
  }

  /**
   * Get info for a specific published app.
   * Returns null if the app doesn't exist.
   */
  async getAppInfo(appId: string): Promise<PublishedAppInfo | null> {
    return this.appsClient.get(appId);
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
  // Apps Client (used for app publishing)
  // ===========================================================================

  private get appsClient(): AppsClient {
    return new AppsClient({
      appsUrl: this.urls.apps,
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
   * Use this escape hatch for app-specific operations not covered by the typed API.
   * 
   * @example
   * const result = await client.graphql<{ lastMessages: Message[] }>(
   *   `query trace($spaceId: String!) { trace(spaceId: $spaceId) }`,
   *   { spaceId: 'abc123' }
   * );
   */
  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return this.graphqlClient.query<T>(query, variables);
  }

  // ===========================================================================
  // Private Methods - Space Registry
  // ===========================================================================

  private registerSpace(spaceId: string, space: RoolSpace): void {
    this.openSpaces.set(spaceId, space);
  }

  private unregisterSpace(spaceId: string): void {
    this.openSpaces.delete(spaceId);
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
          id: event.spaceId!,
          name: event.name ?? event.spaceId!,
          role: (event.role as RoolUserRole) ?? 'owner',
          ownerId: event.ownerId ?? '',
          size: event.size ?? 0,
          createdAt: event.createdAt ?? new Date().toISOString(),
          updatedAt: event.updatedAt ?? new Date().toISOString(),
          linkAccess: 'none', // New spaces default to no link access
        });
        break;

      case 'space_deleted':
        this.emit('spaceRemoved', event.spaceId!);
        break;

      case 'space_renamed':
        this.emit('spaceRenamed', event.spaceId!, event.name ?? event.spaceId!);
        break;

      case 'space_access_changed':
        if (event.role === 'none') {
          // Access revoked - remove from list
          this.emit('spaceRemoved', event.spaceId!);
        } else {
          // Access granted or changed - add/update in list
          this.emit('spaceAdded', {
            id: event.spaceId!,
            name: event.name!,
            role: event.role as RoolUserRole,
            ownerId: event.ownerId!,
            size: event.size!,
            createdAt: event.createdAt!,
            updatedAt: event.updatedAt!,
            linkAccess: (event.linkAccess as LinkAccess) ?? 'none',
          });
        }
        break;

      case 'user_storage_changed':
        this.handleUserStorageChanged(event.key!, event.value);
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
