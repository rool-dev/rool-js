
import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient, OpenSpaceFullResult } from './graphql.js';
import type { RestClient } from './rest.js';
import { SpaceSubscriptionManager } from './subscription.js';
import { RoolChannel } from './channel.js';
import { RoolWebDAV, type SpaceFileStorageUsage } from './webdav.js';
import { machinePath } from './path.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';
import type { SpaceRouter, RouteInfo } from './router.js';
import type {
  RoolUserRole,
  InviteRole,
  SpaceInvite,
  SpaceInviteCreated,
  SpaceMember,
  ChannelInfo,
  ChannelEvent,
  Channel,
  RoolSpaceEvents,
  RoolObjectStat,
  SpaceSchema,
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
  /** Called when the space is closed, so the client can remove it from cache. */
  onClose: () => void;
}

/** Convert a full Channel object to a ChannelInfo summary. */
function channelToInfo(id: string, ch: Channel): ChannelInfo {
  return {
    id,
    name: ch.name ?? null,
    createdAt: ch.createdAt,
    createdBy: ch.createdBy,
    createdByName: ch.createdByName ?? null,
    interactionCount: Object.values(ch.conversations ?? {}).reduce(
      (sum, conv) => sum + (conv.interactions ? Object.keys(conv.interactions).length : 0), 0
    ),
  };
}

/**
 * A space is a container for objects, schema, metadata, and channels.
 *
 * RoolSpace owns the real-time SSE subscription for the space. All channel
 * lifecycle events (created, updated, deleted) are emitted here. Open channels
 * on a space to work with objects and AI.
 *
 * Call close() when done to stop the subscription.
 */
export class RoolSpace extends EventEmitter<RoolSpaceEvents> {
  private _id: string;
  private _name: string;
  private _role: RoolUserRole;
  private _userId: string;
  private _memberCount: number;
  private _channels: ChannelInfo[];
  private _knownChannelIds: Set<string>;
  private graphqlClient: GraphQLClient;
  private restClient: RestClient;
  private authManager: AuthManager;
  private router: SpaceRouter;
  private _route: RouteInfo;
  private _webdav: RoolWebDAV;
  private logger: Logger;
  private onCloseCallback: () => void;

  // Subscription
  private subscriptionManager: SpaceSubscriptionManager | null = null;
  private _closed = false;
  private _resyncing = false;
  private _resyncPending = false;
  private _resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private _subscriptionReady: Promise<void> | null = null;

  // Open channels on this space
  private openChannels = new Map<string, RoolChannel>();

  // Full space data (for channel creation)
  private _objectStats: Record<string, RoolObjectStat>;
  private _schema: SpaceSchema;
  private _meta: Record<string, unknown>;
  private _channelData: Record<string, Channel>;

  constructor(config: SpaceConfig) {
    super();
    this._emitterLogger = config.logger;
    this._id = config.id;
    this._name = config.name;
    this._role = config.role;
    this._userId = config.userId;
    this._memberCount = config.memberCount;
    this.graphqlClient = config.graphqlClient;
    this.restClient = config.restClient;
    this.authManager = config.authManager;
    this.router = config.router;
    this._route = config.initialRoute;
    this._webdav = new RoolWebDAV({
      webdavUrl: this._route.server,
      spaceId: this._id,
      authManager: this.authManager,
      onRefused: async () => {
        await this.reroute();
        return this._route.server;
      },
    });
    this.logger = config.logger;
    this.onCloseCallback = config.onClose;

    this.graphqlClient.setOnRefused(() => this.reroute());
    this.restClient.setOnRefused(async () => {
      await this.reroute();
      return this._route.server;
    });

    // Store full space data
    const fd = config.fullData;
    this._objectStats = fd.objectStats;
    this._schema = fd.schema;
    this._meta = fd.meta;
    this._channelData = fd.channels;

    // Build channel list from full data
    this._channels = Object.entries(fd.channels).map(([id, ch]) => channelToInfo(id, ch));
    this._knownChannelIds = new Set(this._channels.map(c => c.id));

    // Start subscription
    this.startSubscription();
  }


  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get role(): RoolUserRole { return this._role; }
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

  /**
   * Live list of channels in this space.
   * Auto-updates via SSE when channels are created, updated, or deleted.
   */
  get channels(): ChannelInfo[] { return this._channels; }


  private startSubscription(): void {
    let firstProbe = true;
    this.subscriptionManager = new SpaceSubscriptionManager({
      getGraphqlUrl: async () => {
        if (firstProbe) {
          firstProbe = false;
          return this.graphqlClient.graphqlUrl;
        }
        return this.reroute();
      },
      authManager: this.authManager,
      logger: this.logger,
      spaceId: this._id,
      onEvent: (event) => this.handleSpaceEvent(event),
      onConnectionStateChanged: (state: ConnectionState) => {
        this.emit('connectionStateChanged', state);
      },
      onError: (error) => {
        this.logger.error(`[RoolSpace] Space ${this._id} subscription error:`, error);
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
    this.restClient.setApiUrl(route.server);
    const url = `${route.server.replace(/\/+$/, '')}/graphql`;
    this.graphqlClient.setGraphqlUrl(url);
    return url;
  }

  /** Wait for the subscription to be connected. */
  private ensureSubscribed(): Promise<void> {
    return this._subscriptionReady ?? Promise.resolve();
  }


  /**
   * Open a channel on this space.
   * If the channel doesn't exist, the server creates it.
   */
  async openChannel(channelId: string): Promise<RoolChannel> {
    if (!channelId || channelId.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(channelId)) {
      throw new Error('channelId must be 1–32 characters containing only alphanumeric characters, hyphens, and underscores');
    }

    // Ensure channel exists — create if missing
    let channelData = this._channelData[channelId];
    if (!channelData) {
      try {
        channelData = await this.graphqlClient.createChannel(this._id, channelId);
        this._channelData[channelId] = channelData;
      } catch {
        // Race: another client may have created it. Re-fetch.
        const refreshed = await this.graphqlClient.openSpaceFull(this._id);
        this.applyFullData(refreshed);
        channelData = this._channelData[channelId];
        if (!channelData) throw new Error(`Failed to create channel "${channelId}"`);
      }
    }

    const channel = new RoolChannel({
      id: this._id,
      name: this._name,
      role: this._role,
      userId: this._userId,
      objectStats: this._objectStats,
      schema: this._schema,
      meta: this._meta,
      channel: channelData,
      channelId,
      graphqlClient: this.graphqlClient,
      restClient: this.restClient,
      webdav: this.webdav,
      logger: this.logger,
      onClose: () => this.unregisterChannel(channelId),
    });

    this.openChannels.set(channelId, channel);

    // Ensure subscription is connected before returning
    await this.ensureSubscribed();

    return channel;
  }

  private unregisterChannel(channelId: string): void {
    this.openChannels.delete(channelId);
  }


  /**
   * Rename this space.
   */
  async rename(newName: string): Promise<void> {
    await this.graphqlClient.renameSpace(this._id, newName);
    this._name = newName;
  }

  /**
   * Delete this space permanently. Cannot be undone.
   */
  async delete(): Promise<void> {
    await this.graphqlClient.deleteSpace(this._id);
  }


  /**
   * List users with access to this space.
   */
  async listUsers(): Promise<SpaceMember[]> {
    return this.graphqlClient.listSpaceUsers(this._id);
  }

  /**
   * Change an existing member's role. New members join via invites.
   */
  async setUserRole(userId: string, role: InviteRole): Promise<void> {
    return this.graphqlClient.setSpaceUserRole(this._id, userId, role);
  }

  /**
   * Remove a user from this space.
   */
  async removeUser(userId: string): Promise<void> {
    return this.graphqlClient.removeSpaceUser(this._id, userId);
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
    return this.graphqlClient.createSpaceInvite(this._id, role, options);
  }

  /**
   * List this space's currently redeemable invites. Requires owner or admin role.
   */
  async listInvites(): Promise<SpaceInvite[]> {
    return this.graphqlClient.listSpaceInvites(this._id);
  }

  /**
   * Revoke an invite so its link stops working. Requires owner or admin role.
   */
  async revokeInvite(inviteId: string): Promise<boolean> {
    return this.graphqlClient.revokeSpaceInvite(this._id, inviteId);
  }

  /**
   * Rename a channel in this space.
   */
  async renameChannel(channelId: string, name: string): Promise<void> {
    await this.graphqlClient.renameChannel(this._id, channelId, name);
  }

  /**
   * Delete a channel from this space.
   */
  async deleteChannel(channelId: string): Promise<void> {
    await this.graphqlClient.deleteChannel(this._id, channelId);
    // SSE will update the channel list; also update optimistically
    this._channels = this._channels.filter(c => c.id !== channelId);
    this._knownChannelIds.delete(channelId);
    delete this._channelData[channelId];
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
   * Updates name, role, channel list, and all cached data.
   */
  async refresh(): Promise<void> {
    const data = await this.graphqlClient.openSpaceFull(this._id);
    this.applyFullData(data);
  }


  /**
   * Close the space subscription and all open channels.
   */
  close(): void {
    this._closed = true;
    if (this._resyncTimer) { clearTimeout(this._resyncTimer); this._resyncTimer = null; }
    // Close all open channels
    for (const channel of this.openChannels.values()) {
      channel.close();
    }
    this.openChannels.clear();

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
   * Routes to channels and emits channel lifecycle events.
   */
  private handleSpaceEvent(event: ChannelEvent): void {
    // Reconnect or full state change: single fetch, distribute to all channels
    if (event.type === 'connected' || event.type === 'space_changed') {
      this.handleResync();
      return;
    }

    if (event.type === 'space_files_changed') {
      this.emit('filesChanged', { spaceId: event.spaceId, source: event.source, timestamp: event.timestamp });
      return;
    }

    if (event.type === 'space_files_reset') {
      this.emit('filesReset', { spaceId: event.spaceId, source: event.source, timestamp: event.timestamp });
      return;
    }

    // Channel lifecycle events: derive channelCreated/channelUpdated/channelDeleted
    if (event.type === 'channel_updated' && event.channelId && event.channel) {
      const info = channelToInfo(event.channelId, event.channel);

      // Update internal channel data
      this._channelData[event.channelId] = event.channel;

      if (this._knownChannelIds.has(event.channelId)) {
        // Known channel — update in list
        this._channels = this._channels.map(c => c.id === event.channelId ? info : c);
        this.emit('channelUpdated', info);
      } else {
        // New channel
        this._knownChannelIds.add(event.channelId);
        this._channels = [...this._channels, info];
        this.emit('channelCreated', info);
      }

      // Also route to the open channel for channel-internal handling.
      const channel = this.openChannels.get(event.channelId);
      if (channel) channel._handleEvent(event);
      return;
    }

    if (event.type === 'channel_deleted' && event.channelId) {
      this._knownChannelIds.delete(event.channelId);
      this._channels = this._channels.filter(c => c.id !== event.channelId);
      delete this._channelData[event.channelId];
      this.emit('channelDeleted', event.channelId);

      // Route to the open channel (so it can clean up)
      const channel = this.openChannels.get(event.channelId);
      if (channel) channel._handleEvent(event);
      return;
    }

    // Channel-specific events (conversation_updated): route to the matching channel only
    if ('channelId' in event && event.channelId) {
      const channel = this.openChannels.get(event.channelId);
      if (channel) channel._handleEvent(event);
      return;
    }

    // Space-wide non-file events (schema, metadata): broadcast to all channels on this space
    for (const channel of this.openChannels.values()) {
      channel._handleEvent(event);
    }
  }

  // Reconnect resync: fetch full state and distribute. Retries until it lands —
  // a single failure used to leave the client empty until reload. Single-flight:
  // an event arriving mid-resync sets _resyncPending so we re-run once afterward,
  // ensuring the final state reflects the latest space_changed.
  private handleResync(): void {
    if (this._resyncing) { this._resyncPending = true; return; }
    this._resyncing = true;
    this._resyncWithRetry(0);
  }

  private _resyncWithRetry(attempt: number): void {
    this._resyncTimer = null;
    if (this._closed) { this._resyncing = false; return; }
    void this.graphqlClient.openSpaceFull(this._id).then((result) => {
      if (this._closed) { this._resyncing = false; return; }
      this.applyFullData(result);
      for (const [channelId, channel] of this.openChannels) {
        const channelData = result.channels[channelId];
        if (!channelData) continue; // Channel deleted between fetch and distribution
        channel._applyResyncData({
          meta: result.meta,
          schema: result.schema,
          objectStats: result.objectStats,
          channel: channelData,
        });
      }
      this.logger.info(`[RoolSpace] Space ${this._id} resync complete`);
      this._finishResync();
    }).catch((error) => {
      if (this._closed) { this._resyncing = false; return; }
      const ms = Math.min(1000 * 2 ** attempt, 30000);
      this.logger.error(`[RoolSpace] Space ${this._id} resync failed (attempt ${attempt + 1}), retrying in ${ms}ms:`, error);
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
    this._objectStats = data.objectStats;
    this._schema = data.schema;
    this._meta = data.meta;
    this._channelData = data.channels;
    this._channels = Object.entries(data.channels).map(([id, ch]) => channelToInfo(id, ch));
    this._knownChannelIds = new Set(this._channels.map(c => c.id));
  }
}
