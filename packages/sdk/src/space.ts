
import type { GraphQLClient, OpenSpaceFullResult } from './graphql.js';
import type { RestClient } from './rest.js';
import { SpaceSubscriptionManager } from './subscription.js';
import { SpaceOperations, ConversationHandle } from './space-session.js';
import { RoolWebDAV, type SpaceFileStorageUsage } from './webdav.js';
import { machinePath } from './path.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';
import type { SpaceRouter, RouteInfo } from './router.js';
import type { RoolClientInfo } from './client-info.js';
import type {
  RoolUserRole,
  InviteRole,
  SpaceInvite,
  SpaceInviteCreated,
  SpaceMember,
  ConversationInfo,
  SpaceEvent,
  ConnectionState,
} from './types.js';

export interface SpaceConfig {
  id: string;
  name: string;
  role: RoolUserRole;
  userId: string;
  memberCount: number;
  /** Full space data from openSpaceFull */
  fullData: OpenSpaceFullResult;
  graphqlClient: GraphQLClient;
  restClient: RestClient;
  authManager: AuthManager;
  router: SpaceRouter;
  initialRoute: RouteInfo;
  logger: Logger;
  clientInfo: RoolClientInfo;
  /** Called when the space is closed, so the client can remove it from cache. */
  onClose: () => void;
}


/**
 * A space is a container for objects, schema, metadata, and conversations.
 *
 * RoolSpace owns the real-time SSE subscription for the space and exposes
 * space-level object, schema, metadata, and AI operations.
 *
 * Call close() when done to stop the subscription.
 */
export class RoolSpace extends SpaceOperations {
  private _memberCount: number;
  private _conversationInfos: ConversationInfo[];
  private authManager: AuthManager;
  private router: SpaceRouter;
  private _route: RouteInfo;
  private onCloseCallback: () => void;
  private clientInfo: RoolClientInfo;

  // Subscription
  private subscriptionManager: SpaceSubscriptionManager | null = null;
  private _resyncing = false;
  private _resyncPending = false;
  private _resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private _subscriptionReady: Promise<void> | null = null;

  constructor(config: SpaceConfig) {
    let self!: RoolSpace;
    const webdav = new RoolWebDAV({
      webdavUrl: config.initialRoute.server,
      spaceId: config.id,
      authManager: config.authManager,
      clientInfo: config.clientInfo,
      onRefused: async () => {
        await self.reroute();
        return self._route.server;
      },
    });

    super({
      id: config.id,
      name: config.name,
      role: config.role,
      userId: config.userId,
      objectStats: config.fullData.objectStats,
      schema: config.fullData.schema,
      meta: config.fullData.meta,
      conversations: config.fullData.conversations,
      graphqlClient: config.graphqlClient,
      restClient: config.restClient,
      webdav,
      logger: config.logger,
      onClose: () => {},
    });
    this.clientInfo = config.clientInfo;
    self = this;

    this._memberCount = config.memberCount;
    this.authManager = config.authManager;
    this.router = config.router;
    this._route = config.initialRoute;
    this.onCloseCallback = config.onClose;
    this._conversationInfos = this.getConversations();
    this.on('conversationUpdated', () => {
      this._conversationInfos = this.getConversations();
    });

    this._graphqlClient.setOnRefused(() => this.reroute());
    this._restClient.setOnRefused(async () => {
      await this.reroute();
      return this._route.server;
    });

    // Start subscription
    this.startSubscription();
  }


  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get role(): RoolUserRole { return this._role; }
  get userId(): string { return this._userId; }
  get spaceId(): string { return this._id; }
  get spaceName(): string { return this._name; }
  get isReadOnly(): boolean { return this._role === 'viewer'; }
  get memberCount(): number { return this._memberCount; }

  get route(): RouteInfo { return this._route; }

  /** WebDAV client for this space's user-visible files and object filesystem. */
  get webdav(): RoolWebDAV {
    return this._webdav;
  }

  /** Return file-storage quota usage for this space. */
  async getStorageUsage(): Promise<SpaceFileStorageUsage> {
    return this.webdav.getStorageUsage();
  }

  /** Fetch a user-visible file path through the current space. */
  async fetchPath(path: string, options?: {
    range?: string | { start: number; end?: number };
    signal?: AbortSignal;
  }): Promise<Response> {
    const canonical = machinePath(path);
    if (!canonical.startsWith('/rool-drive/')) throw new Error('Path is not a fetchable file');
    return this.webdav.get(canonical, options);
  }

  /** Live list of conversations in this space. */
  get conversations(): ConversationInfo[] { return this._conversationInfos; }


  private startSubscription(): void {
    let firstProbe = true;
    this.subscriptionManager = new SpaceSubscriptionManager({
      getGraphqlUrl: async () => {
        if (firstProbe) {
          firstProbe = false;
          return this._graphqlClient.graphqlUrl;
        }
        return this.reroute();
      },
      authManager: this.authManager,
      logger: this._logger,
      clientInfo: this.clientInfo,
      spaceId: this._id,
      onEvent: (event) => this.handleSpaceEvent(event),
      onConnectionStateChanged: (state: ConnectionState) => {
        this.emit('connectionStateChanged', state);
      },
      onError: (error) => {
        this._logger.error(`[RoolSpace] Space ${this._id} subscription error:`, error);
      },
    });

    this._subscriptionReady = this.subscriptionManager.subscribe();
    // .catch prevents a rejection here from crashing Node before the caller awaits it.
    this._subscriptionReady.catch(() => {});
  }

  private async reroute(): Promise<string> {
    const route = await this.router.resolve(this._id);
    this._route = route;
    this._webdav.setWebDAVUrl(route.server);
    this._restClient.setApiUrl(route.server);
    const url = `${route.server.replace(/\/+$/, '')}/graphql`;
    this._graphqlClient.setGraphqlUrl(url);
    return url;
  }



  /** Get a handle for a conversation in this space. */
  override conversation(conversationId: string): ConversationHandle {
    if (!conversationId || conversationId.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
      throw new Error('conversationId must be 1–32 characters containing only alphanumeric characters, hyphens, and underscores');
    }
    return super.conversation(conversationId);
  }


  /**
   * Rename this space.
   */
  async rename(newName: string): Promise<void> {
    await this._graphqlClient.renameSpace(this._id, newName);
    this._name = newName;
  }

  /**
   * Delete this space permanently. Cannot be undone.
   */
  async delete(): Promise<void> {
    await this._graphqlClient.deleteSpace(this._id);
  }


  /**
   * List users with access to this space.
   */
  async listUsers(): Promise<SpaceMember[]> {
    return this._graphqlClient.listSpaceUsers(this._id);
  }

  /**
   * Change an existing member's role. New members join via invites.
   */
  async setUserRole(userId: string, role: InviteRole): Promise<void> {
    return this._graphqlClient.setSpaceUserRole(this._id, userId, role);
  }

  /**
   * Remove a user from this space.
   */
  async removeUser(userId: string): Promise<void> {
    return this._graphqlClient.removeSpaceUser(this._id, userId);
  }

  /**
   * Mint an invite link for this space. Requires owner or admin role.
   * With `email` set, the invite is single-use, guarded to that address,
   * and sent to it by mail. The returned `url` contains the secret token
   * and is only available here.
   */
  async createInvite(
    role: InviteRole,
    options?: { email?: string; expiresInDays?: number; maxUses?: number }
  ): Promise<SpaceInviteCreated> {
    return this._graphqlClient.createSpaceInvite(this._id, role, options);
  }

  /**
   * List this space's currently redeemable invites. Requires owner or admin role.
   */
  async listInvites(): Promise<SpaceInvite[]> {
    return this._graphqlClient.listSpaceInvites(this._id);
  }

  /**
   * Revoke an invite so its link stops working. Requires owner or admin role.
   */
  async revokeInvite(inviteId: string): Promise<boolean> {
    return this._graphqlClient.revokeSpaceInvite(this._id, inviteId);
  }



  // Targets the owning shard
  async exportArchive(): Promise<Blob> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      'X-Rool-Token': tokens.roolToken,
    };
    const path = `/spaces/${encodeURIComponent(this._id)}/export`;
    const buildUrl = () => `${this._route.server.replace(/\/+$/, '')}${path}`;

    let response = await fetch(buildUrl(), { method: 'GET', headers });
    if (response.status === 421) {
      await this.reroute();
      response = await fetch(buildUrl(), { method: 'GET', headers });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to export space: ${response.status} ${errorText}`);
    }
    return response.blob();
  }


  /**
   * Refresh space data from the server.
   * Updates name, role, conversation list, and all cached data.
   */
  async refresh(): Promise<void> {
    const data = await this._graphqlClient.openSpaceFull(this._id);
    this.applyFullData(data);
  }


  /**
   * Close the space subscription.
   */
  close(): void {
    this._closed = true;
    if (this._resyncTimer) { clearTimeout(this._resyncTimer); this._resyncTimer = null; }

    // Stop subscription
    if (this.subscriptionManager) {
      this.subscriptionManager.destroy();
      this.subscriptionManager = null;
      this._subscriptionReady = null;
    }

    this.removeAllListeners();
    this.onCloseCallback();
  }


  /**
   * Handle a space event from the SSE subscription.
   * Applies bounded space-state events and emits space events.
   */
  private handleSpaceEvent(event: SpaceEvent): void {
    // Reconnect: fetch the current full state once and apply it locally.
    if (event.type === 'connected') {
      this.handleResync();
      return;
    }

    if (event.type === 'space_files_changed') {
      this.emit('filesChanged', { spaceId: event.spaceId, source: event.source, timestamp: event.timestamp });
      // WebDAV is now the source of truth for object/schema/meta writes. Keep
      // the SDK's bounded caches (schema, metadata, object stats, conversations)
      // coherent with remote/local file mutations; the file tree still handles
      // path-level reconciliation via this event.
      this.handleResync();
      return;
    }

    if (event.type === 'space_files_reset') {
      this.emit('filesReset', { spaceId: event.spaceId, source: event.source, timestamp: event.timestamp });
      this.handleResync();
      return;
    }

    this._handleEvent(event);
  }

  // Reconnect resync: fetch full state and distribute. Retries until it lands —
  // a single failure used to leave the client empty until reload. Single-flight:
  // an event arriving mid-resync sets _resyncPending so we re-run once afterward,
  // ensuring the final state reflects the latest server-side file change.
  private handleResync(): void {
    if (this._resyncing) { this._resyncPending = true; return; }
    this._resyncing = true;
    this._resyncWithRetry(0);
  }

  private _resyncWithRetry(attempt: number): void {
    this._resyncTimer = null;
    if (this._closed) { this._resyncing = false; return; }
    void this._graphqlClient.openSpaceFull(this._id).then((result) => {
      if (this._closed) { this._resyncing = false; return; }
      this.applyFullData(result);
      this._logger.info(`[RoolSpace] Space ${this._id} resync complete`);
      this._finishResync();
    }).catch((error) => {
      if (this._closed) { this._resyncing = false; return; }
      const ms = Math.min(1000 * 2 ** attempt, 30000);
      this._logger.error(`[RoolSpace] Space ${this._id} resync failed (attempt ${attempt + 1}), retrying in ${ms}ms:`, error);
      this._resyncTimer = setTimeout(() => this._resyncWithRetry(attempt + 1), ms);
    });
  }

  // Clear in-flight flag; if an event arrived mid-resync, run one more pass.
  private _finishResync(): void {
    this._resyncing = false;
    if (this._resyncPending && !this._closed) {
      this._resyncPending = false;
      this.handleResync();
    }
  }

  /**
   * Apply full space data from server (initial load or resync).
   */
  private applyFullData(data: OpenSpaceFullResult): void {
    this._name = data.name;
    this._role = data.role as RoolUserRole;
    this._memberCount = data.memberCount;
    this._schema = data.schema;
    this._meta = data.meta;
    this._conversations = data.conversations;
    this._objectStats = new Map(Object.entries(data.objectStats));
    this._activeLeaves.clear();
    this._conversationInfos = this.getConversations();
    this.emit('reset', { source: 'system' });
  }
}
