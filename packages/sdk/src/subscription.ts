// =============================================================================
// Subscription Managers
// SSE-based GraphQL subscriptions with auto-reconnect
// =============================================================================

import { createClient, type Client } from 'graphql-sse';
import type { ConnectionState, ClientEvent, ChannelEvent, RoolEventSource, RoolObject, RoolObjectStat, SpaceSchema, Channel, Conversation, ExtensionManifest } from './types.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;
const HEARTBEAT_TIMEOUT = 5_000; // Server sends heartbeats every 2s; reconnect if no message within 5s
const HEARTBEAT_CHECK_INTERVAL = 1_000; // How often to check for stale connection

// =============================================================================
// Client Subscription Manager
// Handles client-level events (space created, deleted, renamed)
// =============================================================================

export interface ClientSubscriptionConfig {
  graphqlUrl: string;
  authManager: AuthManager;
  logger: Logger;
  onEvent: (event: ClientEvent) => void;
  onConnectionStateChanged: (state: ConnectionState) => void;
  onError: (error: Error) => void;
}

export class ClientSubscriptionManager {
  private config: ClientSubscriptionConfig;
  private client: Client | null = null;
  private unsubscribe: (() => void) | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;
  private _isSubscribed = false;
  private logger: Logger;
  private lastMessageAt = 0;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: ClientSubscriptionConfig) {
    this.config = config;
    this.logger = config.logger;
  }

  get isSubscribed(): boolean {
    return this._isSubscribed;
  }

  async subscribe(): Promise<void> {
    if (this._isSubscribed) return;

    this.isIntentionalClose = false;
    await this.connect();
  }

  unsubscribeFromEvents(): void {
    this.isIntentionalClose = true;
    this.cancelReconnect();
    this.stopHeartbeatCheck();
    this.disconnect();
  }

  private async connect(): Promise<void> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) {
      // Token not available - may be refreshing or network not ready after wake
      // Schedule retry instead of giving up
      if (!this.isIntentionalClose) {
        this.scheduleReconnect();
      }
      return;
    }

    this.config.onConnectionStateChanged('reconnecting');

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-Rool-Token': tokens.roolToken,
      };

      this.client = createClient({
        url: this.config.graphqlUrl,
        headers,
      });

      const query = `
        subscription ClientEvents {
          clientEvents
        }
      `;

      this.unsubscribe = this.client.subscribe(
        { query },
        {
          next: (result) => {
            this.reconnectDelay = INITIAL_RECONNECT_DELAY;
            this.resetHeartbeat();

            if (result.data?.clientEvents) {
              try {
                const eventData = result.data.clientEvents as string;
                const rawEvent = JSON.parse(eventData);
                const event = this.parseClientEvent(rawEvent);
                if (event) {
                  // Handle connected event
                  if (event.type === 'connected') {
                    this.logger.info(`[RoolClient] Connected, server version: ${event.serverVersion}`);
                    if (!this._isSubscribed) {
                      this._isSubscribed = true;
                      this.config.onConnectionStateChanged('connected');
                    }
                  }
                  this.config.onEvent(event);
                }
              } catch (e) {
                this.logger.error('[RoolClient] Failed to parse client event:', e);
              }
            }
          },
          error: (error) => {
            this.logger.info('[RoolClient] Client subscription disconnected');
            this.logger.error('[RoolClient] Client subscription error:', error);
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (!this.isIntentionalClose) {
              this.scheduleReconnect();
            }
          },
          complete: () => {
            this.logger.info('[RoolClient] Client subscription disconnected');
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (!this.isIntentionalClose) {
              this.scheduleReconnect();
            }
          },
        }
      );
    } catch (error) {
      this.logger.error('[RoolClient] Failed to establish client subscription:', error);
      this._isSubscribed = false;
      this.config.onConnectionStateChanged('disconnected');

      if (!this.isIntentionalClose) {
        this.scheduleReconnect();
      }
    }
  }

  private disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.client = null;
    this._isSubscribed = false;
    this.config.onConnectionStateChanged('disconnected');
  }

  private scheduleReconnect(): void {
    this.cancelReconnect();

    this.logger.info(`[RoolClient] Client reconnecting in ${this.reconnectDelay}ms...`);
    this.config.onConnectionStateChanged('reconnecting');

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      void this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      MAX_RECONNECT_DELAY
    );
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private resetHeartbeat(): void {
    this.lastMessageAt = Date.now();
    if (!this.heartbeatIntervalId) {
      this.heartbeatIntervalId = setInterval(() => {
        if (this.isIntentionalClose) return;
        if (Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT) {
          this.logger.info('[RoolClient] Heartbeat timeout, forcing reconnect');
          this.stopHeartbeatCheck();
          this.disconnect();
          this.reconnectDelay = INITIAL_RECONNECT_DELAY;
          void this.connect();
        }
      }, HEARTBEAT_CHECK_INTERVAL);
    }
  }

  private stopHeartbeatCheck(): void {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  private parseClientEvent(raw: Record<string, unknown>): ClientEvent | null {
    if (raw.type === 'heartbeat') return null;
    const type = raw.type as ClientEvent["type"];
    const timestamp = raw.timestamp as number;

    if (!type) return null;

    switch (type) {
      case 'connected':
        return { type, timestamp, serverVersion: raw.serverVersion as string };
      case 'space_created':
        return {
          type, timestamp, spaceId: raw.spaceId as string, name: raw.name as string,
          ownerId: raw.ownerId as string | undefined, size: raw.size as number | undefined,
          createdAt: raw.createdAt as string | undefined, updatedAt: raw.updatedAt as string | undefined,
          role: raw.role as string | undefined,
        };
      case 'space_renamed':
        return { type, timestamp, spaceId: raw.spaceId as string, name: raw.name as string };
      case 'space_deleted':
        return { type, timestamp, spaceId: raw.spaceId as string };
      case 'space_access_changed':
        return {
          type, timestamp, spaceId: raw.spaceId as string, name: raw.name as string,
          ownerId: raw.ownerId as string, size: raw.size as number,
          createdAt: raw.createdAt as string, updatedAt: raw.updatedAt as string,
          role: raw.role as string, linkAccess: raw.linkAccess as string,
          memberCount: raw.memberCount as number,
        };
      case 'user_storage_changed':
        return { type, timestamp, key: raw.key as string, value: raw.value };
      case 'channel_created':
        return {
          type, timestamp, spaceId: raw.spaceId as string,
          channelId: raw.channelId as string, name: raw.name as string | undefined,
          channelCreatedAt: raw.createdAt as number | undefined,
          channelCreatedBy: raw.createdBy as string | undefined,
          channelCreatedByName: raw.createdByName as string | undefined,
          channelExtensionUrl: raw.extensionUrl as string | undefined,
          channelExtensionId: raw.extensionId as string | undefined,
          channelManifest: raw.manifest as ExtensionManifest | undefined,
        };
      case 'channel_renamed':
        return { type, timestamp, spaceId: raw.spaceId as string, channelId: raw.channelId as string, name: raw.name as string };
      case 'channel_deleted':
        return { type, timestamp, spaceId: raw.spaceId as string, channelId: raw.channelId as string };
      default:
        this.logger.warn('[RoolClient] Unknown client event type:', type);
        return null;
    }
  }

  destroy(): void {
    this.unsubscribeFromEvents();
  }
}

// =============================================================================
// Space Subscription Manager
// One per space, shared by all channels. Handles object, schema, metadata,
// channel, and conversation events for the entire space.
// =============================================================================

export interface SpaceSubscriptionConfig {
  graphqlUrl: string;
  authManager: AuthManager;
  logger: Logger;
  spaceId: string;
  onEvent: (event: ChannelEvent) => void;
  onConnectionStateChanged: (state: ConnectionState) => void;
  onError: (error: Error) => void;
}

export class SpaceSubscriptionManager {
  private config: SpaceSubscriptionConfig;
  private client: Client | null = null;
  private unsubscribe: (() => void) | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;
  private _isSubscribed = false;
  private _initialConnectPromise: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private logger: Logger;
  private lastMessageAt = 0;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SpaceSubscriptionConfig) {
    this.config = config;
    this.logger = config.logger;
  }

  get isSubscribed(): boolean {
    return this._isSubscribed;
  }

  /**
   * Start the subscription. Returns a promise that resolves when connected.
   * If the initial connection fails, the promise rejects.
   * After initial connection, disconnects trigger auto-reconnect.
   */
  subscribe(): Promise<void> {
    if (this._isSubscribed) return Promise.resolve();

    this.isIntentionalClose = false;

    return new Promise<void>((resolve, reject) => {
      this._initialConnectPromise = { resolve, reject };
      void this.connect();
    });
  }

  unsubscribeFromEvents(): void {
    this.isIntentionalClose = true;
    this.cancelReconnect();
    this.stopHeartbeatCheck();
    this.disconnect();
  }

  private async connect(): Promise<void> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) {
      const error = new Error('Cannot subscribe: not authenticated');
      this.config.onError(error);
      if (this._initialConnectPromise) {
        // Initial connection - reject so caller knows it failed
        this._initialConnectPromise.reject(error);
        this._initialConnectPromise = null;
      } else if (!this.isIntentionalClose) {
        // Reconnect attempt - token may be refreshing, retry
        this.scheduleReconnect();
      }
      return;
    }

    this.logger.info(`[RoolChannel] Space ${this.config.spaceId} connecting...`);
    this.config.onConnectionStateChanged('reconnecting');

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-Rool-Token': tokens.roolToken,
      };

      this.client = createClient({
        url: this.config.graphqlUrl,
        headers,
      });

      const query = `
        subscription SpaceEvents($spaceId: String!) {
          spaceEvents(spaceId: $spaceId)
        }
      `;

      this.unsubscribe = this.client.subscribe(
        {
          query,
          variables: {
            spaceId: this.config.spaceId,
          },
        },
        {
          next: (result) => {
            this.reconnectDelay = INITIAL_RECONNECT_DELAY;
            this.resetHeartbeat();

            if (result.data?.spaceEvents) {
              try {
                const eventData = result.data.spaceEvents as string;
                const rawEvent = JSON.parse(eventData);
                const event = this.parseSpaceEvent(rawEvent);
                if (event) {
                  // Handle connected event - resolve initial promise
                  if (event.type === 'connected') {
                    this.logger.info(`[RoolChannel] Connected to space ${event.spaceId}, server version: ${event.serverVersion}`);
                    if (!this._isSubscribed) {
                      this._isSubscribed = true;
                      this.config.onConnectionStateChanged('connected');
                      if (this._initialConnectPromise) {
                        this._initialConnectPromise.resolve();
                        this._initialConnectPromise = null;
                      }
                    }
                  }
                  this.config.onEvent(event);
                }
              } catch (e) {
                this.logger.error('[RoolChannel] Failed to parse space event:', e);
              }
            }
          },
          error: (error) => {
            this.logger.info(`[RoolChannel] Space ${this.config.spaceId} subscription disconnected`);
            this.logger.error(`[RoolChannel] Space ${this.config.spaceId} subscription error:`, error);
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (this._initialConnectPromise) {
              this._initialConnectPromise.reject(error instanceof Error ? error : new Error(String(error)));
              this._initialConnectPromise = null;
            } else if (!this.isIntentionalClose) {
              this.scheduleReconnect();
            }
          },
          complete: () => {
            this.logger.info(`[RoolChannel] Space ${this.config.spaceId} subscription disconnected`);
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (this._initialConnectPromise) {
              this._initialConnectPromise.reject(new Error('Connection closed before establishing'));
              this._initialConnectPromise = null;
            } else if (!this.isIntentionalClose) {
              this.scheduleReconnect();
            }
          },
        }
      );
    } catch (error) {
      this.logger.error('[RoolChannel] Failed to establish space subscription:', error);
      this._isSubscribed = false;
      this.config.onConnectionStateChanged('disconnected');

      if (this._initialConnectPromise) {
        this._initialConnectPromise.reject(error instanceof Error ? error : new Error(String(error)));
        this._initialConnectPromise = null;
      } else if (!this.isIntentionalClose) {
        this.scheduleReconnect();
      }
    }
  }

  private disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.client = null;
    this._isSubscribed = false;
    this.config.onConnectionStateChanged('disconnected');
  }

  private scheduleReconnect(): void {
    this.cancelReconnect();

    this.logger.info(`[RoolChannel] Space ${this.config.spaceId} reconnecting in ${this.reconnectDelay}ms...`);
    this.config.onConnectionStateChanged('reconnecting');

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      void this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      MAX_RECONNECT_DELAY
    );
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private resetHeartbeat(): void {
    this.lastMessageAt = Date.now();
    if (!this.heartbeatIntervalId) {
      this.heartbeatIntervalId = setInterval(() => {
        if (this.isIntentionalClose) return;
        if (Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT) {
          this.logger.info(`[RoolChannel] Heartbeat timeout, forcing reconnect for space ${this.config.spaceId}`);
          this.stopHeartbeatCheck();
          this.disconnect();
          this.reconnectDelay = INITIAL_RECONNECT_DELAY;
          void this.connect();
        }
      }, HEARTBEAT_CHECK_INTERVAL);
    }
  }

  private stopHeartbeatCheck(): void {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  private parseSpaceEvent(raw: Record<string, unknown>): ChannelEvent | null {
    if (raw.type === 'heartbeat') return null;
    const type = raw.type as ChannelEvent["type"];
    const spaceId = raw.spaceId as string;
    const timestamp = raw.timestamp as number;
    const source = (raw.source as RoolEventSource) ?? 'user';

    if (!type || !spaceId) return null;

    switch (type) {
      case 'connected':
        return { type, spaceId, timestamp, source, serverVersion: raw.serverVersion as number };
      case 'space_changed':
        return { type, spaceId, timestamp, source };
      case 'object_created':
      case 'object_updated':
        return { type, spaceId, timestamp, source, objectId: raw.objectId as string, object: raw.object as RoolObject, objectStat: raw.objectStat as RoolObjectStat | undefined };
      case 'object_deleted':
        return { type, spaceId, timestamp, source, objectId: raw.objectId as string };
      case 'schema_updated':
        return { type, spaceId, timestamp, source, schema: raw.schema as SpaceSchema };
      case 'metadata_updated':
        return { type, spaceId, timestamp, source, metadata: raw.metadata as Record<string, unknown> };
      case 'channel_updated':
        return { type, spaceId, timestamp, source, channelId: raw.channelId as string, channel: raw.channel as Channel | undefined };
      case 'conversation_updated':
        return { type, spaceId, timestamp, source, channelId: raw.channelId as string, conversationId: raw.conversationId as string, conversation: raw.conversation as Conversation };
      case 'channel_deleted':
        return { type, spaceId, timestamp, source, channelId: raw.channelId as string };
      default:
        this.logger.warn('[RoolChannel] Unknown space event type:', type);
        return null;
    }
  }

  destroy(): void {
    this.unsubscribeFromEvents();
  }
}
