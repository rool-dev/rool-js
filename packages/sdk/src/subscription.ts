// =============================================================================
// Subscription Managers
// SSE-based GraphQL subscriptions with auto-reconnect
// =============================================================================

import { createClient, type Client } from 'graphql-sse';
import type { ConnectionState, ClientEvent, SpaceEvent, JSONPatchOp, RoolEventSource } from './types.js';
import type { AuthManager } from './auth.js';

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

  constructor(config: ClientSubscriptionConfig) {
    this.config = config;
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
      this.config.onError(new Error('Cannot subscribe: not authenticated'));
      return;
    }

    this.config.onConnectionStateChanged('reconnecting');

    try {
      this.client = createClient({
        url: this.config.graphqlUrl,
        headers: {
          Authorization: `Bearer ${token}`,
        },
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

            if (!this._isSubscribed) {
              this._isSubscribed = true;
              this.config.onConnectionStateChanged('connected');
            }

            if (result.data?.clientEvents) {
              try {
                const eventData = result.data.clientEvents as string;
                const rawEvent = JSON.parse(eventData);
                const event = this.parseClientEvent(rawEvent);
                if (event) {
                  this.config.onEvent(event);
                }
              } catch (e) {
                console.error('[RoolClient] Failed to parse client event:', e);
              }
            }
          },
          error: (error) => {
            console.error('[RoolClient] Client subscription error:', error);
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
      console.error('[RoolClient] Failed to establish client subscription:', error);
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

    console.log(`[RoolClient] Client reconnecting in ${this.reconnectDelay}ms...`);
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
      case 'space_created':
      case 'space_renamed':
        return { type, spaceId: raw.spaceId as string, timestamp, name: raw.name as string };
      case 'space_deleted':
        return { type, spaceId: raw.spaceId as string, timestamp };
      case 'user_storage_changed':
        return { type, timestamp, key: raw.key as string, value: raw.value };
      default:
        console.warn('[RoolClient] Unknown client event type:', type);
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

  constructor(config: SpaceSubscriptionConfig) {
    this.config = config;
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
      this.config.onError(new Error('Cannot subscribe: not authenticated'));
      return;
    }

    this.config.onConnectionStateChanged('reconnecting');

    try {
      this.client = createClient({
        url: this.config.graphqlUrl,
        headers: {
          Authorization: `Bearer ${token}`,
        },
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

            if (!this._isSubscribed) {
              this._isSubscribed = true;
              this.config.onConnectionStateChanged('connected');
            }

            if (result.data?.spaceEvents) {
              try {
                const eventData = result.data.spaceEvents as string;
                const rawEvent = JSON.parse(eventData);
                const event = this.parseSpaceEvent(rawEvent);
                if (event) {
                  this.config.onEvent(event);
                }
              } catch (e) {
                console.error('[RoolSpace] Failed to parse space event:', e);
              }
            }
          },
          error: (error) => {
            console.error('[RoolSpace] Space subscription error:', error);
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
      console.error('[RoolSpace] Failed to establish space subscription:', error);
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

    console.log(`[RoolSpace] Space ${this.config.spaceId} reconnecting in ${this.reconnectDelay}ms...`);
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

    if (!type || !spaceId || !source) return null;

    switch (type) {
      case 'space_patched':
        return {
          type,
          spaceId,
          timestamp,
          patch: raw.patch as JSONPatchOp[],
          source,
        };
      case 'space_changed':
        return { type, spaceId, timestamp, source };
      default:
        console.warn('[RoolSpace] Unknown space event type:', type);
        return null;
    }
  }

  destroy(): void {
    this.unsubscribeFromEvents();
  }
}
