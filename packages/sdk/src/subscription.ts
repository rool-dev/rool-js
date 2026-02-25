// =============================================================================
// Subscription Managers
// SSE-based GraphQL subscriptions with auto-reconnect
// =============================================================================

import { createClient, type Client } from 'graphql-sse';
import type { ConnectionState, ClientEvent, SpaceEvent, JSONPatchOp, RoolEventSource } from './types.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;

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
    this.disconnect();
  }

  private async connect(): Promise<void> {
    const token = await this.config.authManager.getToken();
    if (!token) {
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
        Authorization: `Bearer ${token}`,
      };
      const roolToken = this.config.authManager.getRoolToken();
      if (roolToken) headers['X-Rool-Token'] = roolToken;

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
            this.logger.error('[RoolClient] Client subscription error:', error);
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (!this.isIntentionalClose) {
              this.scheduleReconnect();
            }
          },
          complete: () => {
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

  private parseClientEvent(raw: Record<string, unknown>): ClientEvent | null {
    const type = raw.type as ClientEvent["type"];
    const timestamp = raw.timestamp as number;

    if (!type) return null;

    switch (type) {
      case 'connected':
        return { type, timestamp, serverVersion: raw.serverVersion as string };
      case 'space_created':
      case 'space_renamed':
        return { type, spaceId: raw.spaceId as string, timestamp, name: raw.name as string };
      case 'space_deleted':
        return { type, spaceId: raw.spaceId as string, timestamp };
      case 'user_storage_changed':
        return { type, timestamp, key: raw.key as string, value: raw.value };
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
// Handles space-level events (patched, changed) for a specific space
// =============================================================================

export interface SpaceSubscriptionConfig {
  graphqlUrl: string;
  authManager: AuthManager;
  logger: Logger;
  spaceId: string;
  conversationId: string;
  onEvent: (event: SpaceEvent) => void;
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
    this.disconnect();
  }

  private async connect(): Promise<void> {
    const token = await this.config.authManager.getToken();
    if (!token) {
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

    this.config.onConnectionStateChanged('reconnecting');

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      const roolToken = this.config.authManager.getRoolToken();
      if (roolToken) headers['X-Rool-Token'] = roolToken;

      this.client = createClient({
        url: this.config.graphqlUrl,
        headers,
      });

      const query = `
        subscription SpaceEvents($spaceId: String!, $conversationId: String!) {
          spaceEvents(spaceId: $spaceId, conversationId: $conversationId)
        }
      `;

      this.unsubscribe = this.client.subscribe(
        {
          query,
          variables: {
            spaceId: this.config.spaceId,
            conversationId: this.config.conversationId,
          },
        },
        {
          next: (result) => {
            this.reconnectDelay = INITIAL_RECONNECT_DELAY;

            if (result.data?.spaceEvents) {
              try {
                const eventData = result.data.spaceEvents as string;
                const rawEvent = JSON.parse(eventData);
                const event = this.parseSpaceEvent(rawEvent);
                if (event) {
                  // Handle connected event - resolve initial promise
                  if (event.type === 'connected') {
                    this.logger.info(`[RoolSpace] Connected to space ${event.spaceId}, server version: ${event.serverVersion}`);
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
                this.logger.error('[RoolSpace] Failed to parse space event:', e);
              }
            }
          },
          error: (error) => {
            this.logger.error('[RoolSpace] Space subscription error:', error);
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (this._initialConnectPromise) {
              // Initial connection failed - reject and don't auto-reconnect
              this._initialConnectPromise.reject(error instanceof Error ? error : new Error(String(error)));
              this._initialConnectPromise = null;
            } else if (!this.isIntentionalClose) {
              // Established connection dropped - auto-reconnect
              this.scheduleReconnect();
            }
          },
          complete: () => {
            this._isSubscribed = false;
            this.config.onConnectionStateChanged('disconnected');

            if (this._initialConnectPromise) {
              // Connection closed before establishing - reject
              this._initialConnectPromise.reject(new Error('Connection closed before establishing'));
              this._initialConnectPromise = null;
            } else if (!this.isIntentionalClose) {
              this.scheduleReconnect();
            }
          },
        }
      );
    } catch (error) {
      this.logger.error('[RoolSpace] Failed to establish space subscription:', error);
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

    this.logger.info(`[RoolSpace] Space ${this.config.spaceId} reconnecting in ${this.reconnectDelay}ms...`);
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

  private parseSpaceEvent(raw: Record<string, unknown>): SpaceEvent | null {
    const type = raw.type as SpaceEvent["type"];
    const spaceId = raw.spaceId as string;
    const timestamp = raw.timestamp as number;
    const source = raw.source as RoolEventSource;

    if (!type || !spaceId) return null;

    switch (type) {
      case 'connected':
        return {
          type,
          spaceId,
          timestamp,
          source: source ?? 'user',  // connected event may not have source
          serverVersion: raw.serverVersion as number,
        };
      case 'space_patched':
        if (!source) return null;
        return {
          type,
          spaceId,
          timestamp,
          patch: raw.patch as JSONPatchOp[],
          source,
        };
      case 'space_changed':
        if (!source) return null;
        return { type, spaceId, timestamp, source };
      default:
        this.logger.warn('[RoolSpace] Unknown space event type:', type);
        return null;
    }
  }

  destroy(): void {
    this.unsubscribeFromEvents();
  }
}
