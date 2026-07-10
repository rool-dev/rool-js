import { EventEmitter } from './event-emitter.js';
import { AuthManager } from './auth.js';
import { GraphQLClient } from './graphql.js';
import { ClientSubscriptionManager } from './subscription.js';
import { RestClient } from './rest.js';
import { RoolSpace } from './space.js';
import { SpaceRouter } from './router.js';
import { generateEntityId } from './space-session.js';
import { defaultLogger, type Logger } from './logger.js';
import { addClientInfoHeaders, resolveClientInfo, type RoolClientInfo } from './client-info.js';
import type {
  RoolClientConfig,
  RoolClientEvents,
  RoolSpaceInfo,
  RoolUserRole,
  ClientEvent,
  CurrentUser,
  InvitePreview,
  InviteRedeemResult,
  AuthUser,
  ConnectionState,
  PasswordSignInResult,
} from './types.js';

type ResolvedUrls = {
  graphql: string;
  auth: string;
  webdav: string;
};

/**
 * Rool Client - Manages authentication, space lifecycle, and shared infrastructure.
 *
 * The client is lightweight - most operations happen on RoolSpace instances.
 *
 * Features:
 * - Authentication (login, logout, token management)
 * - Space lifecycle (list, create, delete, rename)
 * - Client-level subscription for lifecycle events
 * - User storage (cross-device key-value storage)
 */
export class RoolClient extends EventEmitter<RoolClientEvents> {
  private baseUrl: string;
  private urls: ResolvedUrls;
  private authManager: AuthManager;
  private graphqlClient: GraphQLClient;
  private router: SpaceRouter;
  private subscriptionManager: ClientSubscriptionManager | null = null;
  private logger: Logger;
  private clientInfo: RoolClientInfo;
  private _serverInfo: { version: string; minimumSdkVersion?: string | null; compatibility: 'ok' | 'unsupported' } | null = null;

  // Open spaces (cached for reuse)
  private openSpaces = new Map<string, RoolSpace>();

  // User storage cache (in-memory; populated from server on initialize)
  private _storageCache: Record<string, unknown> = {};

  // Current user (fetched during initialize)
  private _currentUser: CurrentUser | null = null;

  constructor(config: RoolClientConfig = {}) {
    super();

    this.logger = config.logger ?? defaultLogger;
    this._emitterLogger = this.logger;
    this.clientInfo = resolveClientInfo(config.client);

    // Resolve API origin and auth URL.
    // Auth is derived by stripping the api. hostname prefix from the API URL.
    // For local dev (localhost etc.), set authUrl explicitly.
    const apiOrigin = ((config.apiUrl ?? config.baseUrl) ?? 'https://api.rool.dev').replace(/\/+$/, '');

    let authOrigin = apiOrigin;
    try {
      const parsed = new URL(apiOrigin);
      if (parsed.hostname.startsWith('api.')) {
        parsed.hostname = parsed.hostname.slice(4);
        authOrigin = parsed.origin;
      }
    } catch { /* keep apiOrigin as fallback */ }

    this.baseUrl = apiOrigin;
    this.urls = {
      graphql: config.graphqlUrl ?? `${apiOrigin}/graphql`,
      auth: config.authUrl ?? `${authOrigin}/auth`,
      webdav: apiOrigin,
    };

    this.authManager = new AuthManager({
      authUrl: this.urls.auth,
      authProvider: config.authProvider,
      logger: this.logger,
      onAuthStateChanged: (authenticated) => {
        // Covers every sign-out path (logout() and 401-driven token clearing).
        if (!authenticated) {
          this._storageCache = {};
          this.setCurrentUser(null);
        }
        this.emit('authStateChanged', authenticated);
      },
    });

    this.graphqlClient = new GraphQLClient({
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
    });

    this.router = new SpaceRouter({
      apiUrl: this.baseUrl,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
    });
  }


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
      await this.hydrateAuthenticatedSession();
    }
    return authenticated;
  }

  /**
   * Start the realtime subscription and load the current user/storage. Shared
   * by initialize() and verify() — any path that lands the user in an
   * authenticated state needs this hydration.
   *
   * Hydration is best-effort and never throws: a backend outage must not read
   * as a logout. The subscription owns reconnect/backoff and refetches the user
   * on (re)connect (see ensureSubscribed), so a session that boots while the
   * server is down stays authenticated and self-heals when it returns. Only a
   * hard auth failure (401) ends the session, via the token layer.
   */
  private async hydrateAuthenticatedSession(): Promise<void> {
    this.ensureSubscribed().catch((error) => {
      this.logger.warn('[RoolClient] subscription start deferred:', error);
    });

    try {
      await this.fetchUserAndStorage();
    } catch (error) {
      this.logger.warn('[RoolClient] user hydration deferred (offline?):', error);
    }
  }

  /**
   * Fetch the current user and populate the storage cache, then emit
   * currentUserChanged. Cache is set before the emit so listeners reading
   * getAllUserStorage() in response see fresh storage.
   */
  private async fetchUserAndStorage(): Promise<void> {
    const user = await this.graphqlClient.getCurrentUser();
    this._storageCache = user.storage ?? {};
    this.setCurrentUser(user);
  }

  private setCurrentUser(user: CurrentUser | null): void {
    this._currentUser = user;
    this.emit('currentUserChanged', user);
  }

  /**
   * Clean up resources - call when destroying the client.
   */
  destroy(): void {
    this.authManager.destroy();
    this.subscriptionManager?.destroy();

    // Close all open spaces and subscriptions
    for (const space of this.openSpaces.values()) space.close();
    this.openSpaces.clear();

    this.removeAllListeners();
  }


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
   * Complete an email verification flow using a token from the verification
   * email link. Exchanges the token for a live session and signs the user in
   * without a redirect. Intended to be called when the app detects a
   * `?verify=<token>` query parameter on load.
   *
   * Returns true if the user is now signed in as a result.
   */
  async verify(token: string): Promise<boolean> {
    const ok = await this.authManager.verify(token);
    if (ok) {
      await this.hydrateAuthenticatedSession();
    }
    return ok;
  }

  /**
   * Complete a native sign-in (PKCE) from a deep-link callback URL. Call this
   * from the app's platform deep-link handler (e.g. Capacitor's `appUrlOpen`)
   * with the full callback URL. Exchanges the code for a live session.
   *
   * Returns true if the user is now signed in as a result.
   */
  async handleAuthRedirect(url: string): Promise<boolean> {
    const ok = await this.authManager.handleRedirect(url);
    if (ok) {
      await this.hydrateAuthenticatedSession();
    }
    return ok;
  }

  /**
   * Sign in with email + password. Resolves to `{ status: 'signed_in' }` once
   * authenticated, or `{ status: 'verify_required' }` when the account's email
   * isn't verified yet (a magic link has been emailed). Rejects with a
   * human-readable Error on bad credentials or server failure.
   */
  async signInWithPassword(email: string, password: string): Promise<PasswordSignInResult> {
    const result = await this.authManager.signInWithPassword(email, password);
    if (result.status === 'signed_in') {
      await this.hydrateAuthenticatedSession();
    }
    return result;
  }

  /**
   * Request a magic sign-in link by email. The server emails a link; the user
   * completes sign-in by following it, which is finished via `verify()` /
   * `handleAuthRedirect()` when it lands back in the app. Resolves once the
   * email is accepted; rejects with a human-readable Error on a bad address.
   */
  async requestMagicLink(email: string): Promise<void> {
    return this.authManager.requestMagicLink(email);
  }

  /**
   * Set or change the current user's password. Requires an authenticated session.
   * Password must be at least 8 characters and contain both letters and either
   * digits or symbols.
   *
   * Throws an Error with a human-readable message on validation or server failure.
   */
  async setPassword(password: string): Promise<void> {
    return this.authManager.setPassword(password);
  }

  /**
   * Logout - clear all tokens and state.
   */
  logout(): void {
    this.authManager.logout();
    this.unsubscribe();

    // Close all open spaces and subscriptions
    for (const space of this.openSpaces.values()) space.close();
    this.openSpaces.clear();
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
    addClientInfoHeaders(headers, this.clientInfo);

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

  get serverInfo(): { version: string; minimumSdkVersion?: string | null; compatibility: 'ok' | 'unsupported' } | null {
    return this._serverInfo;
  }


  /**
   * List all spaces accessible to the user.
   */
  async listSpaces(): Promise<RoolSpaceInfo[]> {
    return this.graphqlClient.listSpaces();
  }

  /**
   * Open a space with a real-time subscription.
   * Returns a live RoolSpace handle with conversation and file events.
   * Reuses an existing handle if the space is already open.
   *
   * Call space.close() when done to stop the subscription.
   */
  async openSpace(spaceId: string): Promise<RoolSpace> {
    // Reuse existing open space
    const existing = this.openSpaces.get(spaceId);
    if (existing) return existing;

    // Ensure client subscription is active (for lifecycle events)
    // .catch prevents a rejection here from crashing Node before the caller awaits it.
    this.ensureSubscribed().catch(() => { });

    const initialRoute = await this.router.resolve(spaceId);
    const scopedGraphqlUrl = `${initialRoute.server.replace(/\/+$/, '')}/graphql`;
    const scopedClient = new GraphQLClient({
      graphqlUrl: scopedGraphqlUrl,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
    });
    const scopedRestClient = new RestClient({
      apiUrl: initialRoute.server,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
    });

    const fullData = await scopedClient.openSpaceFull(spaceId);

    const space = new RoolSpace({
      id: spaceId,
      name: fullData.name,
      role: fullData.role as RoolUserRole,
      userId: fullData.userId,
      memberCount: fullData.memberCount,
      fullData,
      graphqlClient: scopedClient,
      restClient: scopedRestClient,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
      router: this.router,
      initialRoute,
      logger: this.logger,
      onClose: () => this.openSpaces.delete(spaceId),
    });

    this.openSpaces.set(spaceId, space);


    return space;
  }

  /**
   * Create a new space.
   * Returns a RoolSpace handle with a real-time subscription.
   * Use the returned RoolSpace to work with objects, conversations, and AI.
   */
  async createSpace(name: string): Promise<RoolSpace> {
    // Prevents a rejection here from crashing Node before the caller awaits it.
    this.ensureSubscribed().catch(() => { });

    const { spaceId } = await this.graphqlClient.createSpace(name);
    return this.openSpace(spaceId);
  }

  /**
   * Delete a space.
   * Note: This closes any cached open RoolSpace handle.
   */
  async deleteSpace(spaceId: string): Promise<void> {
    await this.graphqlClient.deleteSpace(spaceId);
    // Close and remove the cached space if open
    const space = this.openSpaces.get(spaceId);
    if (space) {
      space.close();
      this.openSpaces.delete(spaceId);
    }
    // Client-level event will be emitted via SSE subscription
  }

  /**
   * Duplicate an existing space. Returns a handle to the new space.
   */
  async duplicateSpace(sourceSpaceId: string, name: string): Promise<RoolSpace> {
    this.ensureSubscribed().catch(() => { });
    const { spaceId } = await this.graphqlClient.duplicateSpace(sourceSpaceId, name);
    return this.openSpace(spaceId);
  }

  /**
   * Mark the current user for deletion (7-day grace period).
   * Irrecoverable after the grace period elapses.
   */
  async deleteCurrentUser(): Promise<void> {
    await this.graphqlClient.deleteCurrentUser();
    this.logout();
  }

  /**
   * Import a space from a zip archive.
   * Creates a new space with the given name and imports objects, relations, and files.
   * Returns a RoolSpace handle.
   */
  async importArchive(name: string, archive: Blob): Promise<RoolSpace> {
    // .catch prevents a rejection here from crashing Node before the caller awaits it.
    this.ensureSubscribed().catch(() => { });

    // Import via REST endpoint (creates the space)
    const spaceId = await this.restClient.importArchive(name, archive);

    // Open the space to get its data
    return this.openSpace(spaceId);
  }

  /**
   * Get the current Rool user from the server.
   * Returns the user's server-assigned id, email, plan, and credits.
   */
  async getCurrentUser(): Promise<CurrentUser> {
    const user = await this.graphqlClient.getCurrentUser();
    // On first hydration, populate the storage cache before emitting so
    // listeners don't see a user with empty storage. Once hydrated, a polled
    // snapshot must not clobber optimistic setUserStorage writes.
    if (!this._currentUser) {
      this._storageCache = user.storage ?? {};
    }
    this.setCurrentUser(user);
    return user;
  }

  /**
   * Look up an invite link by its token, without redeeming it.
   * Does not require authentication.
   */
  async previewInvite(token: string): Promise<InvitePreview> {
    return this.restClient.previewInvite(token);
  }

  /**
   * Redeem an invite link, joining the space it belongs to.
   */
  async redeemInvite(token: string): Promise<InviteRedeemResult> {
    return this.restClient.redeemInvite(token);
  }

  /**
   * Update the current user's profile.
   * - name: display name
   * - slug: used in app publishing URLs (3-32 chars, start with letter, lowercase alphanumeric/hyphens/underscores)
   */
  async updateCurrentUser(input: { name?: string; slug?: string; marketingOptIn?: boolean }): Promise<CurrentUser> {
    const user = await this.graphqlClient.updateCurrentUser(input);
    this.setCurrentUser(user);
    return user;
  }

  /**
   * Get a value from user storage (sync read from in-memory cache).
   * Cache is populated from the server on initialize().
   * Returns undefined if key doesn't exist.
   */
  getUserStorage<T = unknown>(key: string): T | undefined {
    return this._storageCache[key] as T | undefined;
  }

  /**
   * Set a value in user storage.
   * Updates in-memory cache immediately, then syncs to server.
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

  /**
   * Report an event to the server.
   * Fire-and-forget — errors are logged but not propagated.
   */
  reportEvent(event: string, url?: string): void {
    this.graphqlClient.reportEvent(event, url).catch((error) => {
      this.logger.error('[RoolClient] Failed to report event:', error);
    });
  }


  private get restClient(): RestClient {
    return new RestClient({
      apiUrl: this.baseUrl,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
    });
  }


  /**
   * Ensure the client-level event subscription is active.
   * Called automatically when opening spaces.
   * @internal
   */
  private async ensureSubscribed(): Promise<void> {
    if (this.subscriptionManager) return;

    this.subscriptionManager = new ClientSubscriptionManager({
      graphqlUrl: this.urls.graphql,
      authManager: this.authManager,
      clientInfo: this.clientInfo,
      logger: this.logger,
      onEvent: (event) => this.handleClientEvent(event),
      onConnectionStateChanged: (state: ConnectionState) => {
        this.emit('connectionStateChanged', state);
        // Finish a deferred hydration: if we booted while the server was down,
        // _currentUser is still null. Now that we're connected, fetch the user
        // and storage so the app can complete sign-in.
        if (state === 'connected' && !this._currentUser) {
          this.fetchUserAndStorage().catch((error) => {
            this.logger.warn('[RoolClient] deferred user hydration failed:', error);
          });
        }
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


  /**
   * Generate a unique 6-character alphanumeric ID.
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


  /**
   * Handle a client-level event from the subscription.
   * @internal
   */
  private handleClientEvent(event: ClientEvent): void {
    switch (event.type) {
      case 'connected': {
        const info = {
          version: event.serverVersion,
          minimumSdkVersion: event.minimumSdkVersion,
          compatibility: event.compatibility ?? 'ok' as const,
        };
        this._serverInfo = info;
        this.emit('serverInfoChanged', info);
        if (info.compatibility === 'unsupported') this.emit('unsupported', info);
        break;
      }
      case 'space_created':
        this.emit('spaceAdded', {
          id: event.spaceId,
          name: event.name,
          inboundEmailAddress: event.inboundEmailAddress ?? '',
          role: (event.role as RoolUserRole) ?? 'owner',
          ownerId: event.ownerId ?? '',
          size: event.size ?? 0,
          createdAt: event.createdAt ?? new Date().toISOString(),
          updatedAt: event.updatedAt ?? new Date().toISOString(),
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
            inboundEmailAddress: event.inboundEmailAddress,
            role: event.role as RoolUserRole,
            ownerId: event.ownerId,
            size: event.size,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            memberCount: event.memberCount,
          });
        }
        break;

      case 'user_storage_changed':
        this.handleUserStorageChanged(event.key, event.value);
        break;

    }
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

      this.emit('userStorageChanged', { key, value: value ?? null, source: 'remote' });
    }
  }
}
