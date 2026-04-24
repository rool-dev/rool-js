// =============================================================================
// RoolSpace — Space handle with real-time subscription
// =============================================================================

import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient, OpenSpaceFullResult } from './graphql.js';
import type { MediaClient } from './media.js';
import { SpaceSubscriptionManager } from './subscription.js';
import { RoolChannel } from './channel.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';
import type { SpaceRouter, RouteInfo } from './router.js';
import type {
  RoolUserRole,
  LinkAccess,
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
  linkAccess: LinkAccess;
  memberCount: number;
  /** Full space data from openSpaceFull */
  fullData: OpenSpaceFullResult;
  graphqlClient: GraphQLClient;
  mediaClient: MediaClient;
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
    extensionUrl: ch.extensionUrl ?? null,
    extensionId: ch.extensionId ?? null,
    manifest: ch.manifest ?? null,
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
  private _linkAccess: LinkAccess;
  private _memberCount: number;
  private _channels: ChannelInfo[];
  private _knownChannelIds: Set<string>;
  private graphqlClient: GraphQLClient;
  private mediaClient: MediaClient;
  private authManager: AuthManager;
  private router: SpaceRouter;
  private _route: RouteInfo;
  private logger: Logger;
  private onCloseCallback: () => void;

  // Subscription
  private subscriptionManager: SpaceSubscriptionManager | null = null;
  private _subscriptionReady: Promise<void> | null = null;

  // Open channels on this space
  private openChannels = new Map<string, RoolChannel>();

  // Full space data (for channel creation)
  private _objectIds: string[];
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
    this._linkAccess = config.linkAccess;
    this._memberCount = config.memberCount;
    this.graphqlClient = config.graphqlClient;
    this.mediaClient = config.mediaClient;
    this.authManager = config.authManager;
    this.router = config.router;
    this._route = config.initialRoute;
    this.logger = config.logger;
    this.onCloseCallback = config.onClose;

    this.graphqlClient.setOnRefused(() => this.reroute());

    // Store full space data
    const fd = config.fullData;
    this._objectIds = fd.objectIds;
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

  // ===========================================================================
  // Properties
  // ===========================================================================

  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get role(): RoolUserRole { return this._role; }
  get linkAccess(): LinkAccess { return this._linkAccess; }
  get memberCount(): number { return this._memberCount; }

  get route(): RouteInfo { return this._route; }

  /**
   * Live list of channels in this space.
   * Auto-updates via SSE when channels are created, updated, or deleted.
   */
  get channels(): ChannelInfo[] { return this._channels; }

  // ===========================================================================
  // Subscription
  // ===========================================================================

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
  }

  private async reroute(): Promise<string> {
    const route = await this.router.resolve(this._id);
    this._route = route;
    const url = `${route.server.replace(/\/+$/, '')}/graphql`;
    this.graphqlClient.setGraphqlUrl(url);
    return url;
  }

  /** Wait for the subscription to be connected. */
  private ensureSubscribed(): Promise<void> {
    return this._subscriptionReady ?? Promise.resolve();
  }

  // ===========================================================================
  // Channel Lifecycle
  // ===========================================================================

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
      linkAccess: this._linkAccess,
      userId: this._userId,
      objectIds: this._objectIds,
      objectStats: this._objectStats,
      schema: this._schema,
      meta: this._meta,
      channel: channelData,
      channelId,
      graphqlClient: this.graphqlClient,
      mediaClient: this.mediaClient,
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

  // ===========================================================================
  // Space Admin
  // ===========================================================================

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

  // ===========================================================================
  // User Management
  // ===========================================================================

  /**
   * List users with access to this space.
   */
  async listUsers(): Promise<SpaceMember[]> {
    return this.graphqlClient.listSpaceUsers(this._id);
  }

  /**
   * Add a user to this space with specified role.
   */
  async addUser(userId: string, role: RoolUserRole): Promise<void> {
    return this.graphqlClient.addSpaceUser(this._id, userId, role);
  }

  /**
   * Remove a user from this space.
   */
  async removeUser(userId: string): Promise<void> {
    return this.graphqlClient.removeSpaceUser(this._id, userId);
  }

  /**
   * Set the link sharing level for this space.
   * Requires owner or admin role.
   */
  async setLinkAccess(linkAccess: LinkAccess): Promise<void> {
    const previous = this._linkAccess;
    this._linkAccess = linkAccess;
    try {
      await this.graphqlClient.setLinkAccess(this._id, linkAccess);
    } catch (error) {
      this._linkAccess = previous;
      throw error;
    }
  }

  // ===========================================================================
  // Channel Management
  // ===========================================================================

  /**
   * List channels in this space.
   * Returns the live channel list (kept current via SSE).
   * @deprecated Use the `channels` property instead.
   */
  getChannels(): ChannelInfo[] {
    return this._channels;
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

  // ===========================================================================
  // Export
  // ===========================================================================

  /**
   * Export space data and media as a zip archive.
   */
  async exportArchive(): Promise<Blob> {
    return this.mediaClient.exportArchive(this._id);
  }

  // ===========================================================================
  // Refresh
  // ===========================================================================

  /**
   * Refresh space data from the server.
   * Updates name, role, linkAccess, channel list, and all cached data.
   */
  async refresh(): Promise<void> {
    const data = await this.graphqlClient.openSpaceFull(this._id);
    this.applyFullData(data);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Close the space subscription and all open channels.
   */
  close(): void {
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

  // ===========================================================================
  // Event Routing (internal)
  // ===========================================================================

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

      // Also route to the open channel (for channel-internal handling like name/extension updates)
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

    // Space-wide events (objects, schema, metadata):
    // broadcast to all channels on this space
    for (const channel of this.openChannels.values()) {
      channel._handleEvent(event);
    }
  }

  /**
   * Handle reconnection: fetch full state once, distribute to all channels.
   */
  private handleResync(): void {
    this.logger.info(`[RoolSpace] Space ${this._id} reconnected, resyncing...`);

    void this.graphqlClient.openSpaceFull(this._id).then((result) => {
      this.applyFullData(result);

      // Distribute to all open channels
      for (const [channelId, channel] of this.openChannels) {
        const channelData = result.channels[channelId];
        if (!channelData) continue; // Channel was deleted between fetch and distribution
        channel._applyResyncData({
          meta: result.meta,
          schema: result.schema,
          objectIds: result.objectIds,
          objectStats: result.objectStats,
          channel: channelData,
        });
      }
      this.logger.info(`[RoolSpace] Space ${this._id} resync complete (${result.objectIds.length} objects)`);
    }).catch((error) => {
      this.logger.error(`[RoolSpace] Space ${this._id} resync failed:`, error);
    });
  }

  /**
   * Apply full space data from server (initial load or resync).
   */
  private applyFullData(data: OpenSpaceFullResult): void {
    this._name = data.name;
    this._role = data.role as RoolUserRole;
    this._linkAccess = data.linkAccess;
    this._memberCount = data.memberCount;
    this._objectIds = data.objectIds;
    this._objectStats = data.objectStats;
    this._schema = data.schema;
    this._meta = data.meta;
    this._channelData = data.channels;
    this._channels = Object.entries(data.channels).map(([id, ch]) => channelToInfo(id, ch));
    this._knownChannelIds = new Set(this._channels.map(c => c.id));
  }
}
