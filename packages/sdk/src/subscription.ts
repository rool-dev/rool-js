// =============================================================================
// Subscription Managers
// SSE-based GraphQL subscriptions with auto-reconnect.
// See SUBSCRIPTION.md for the state machine spec.
// =============================================================================

import { createClient, type Client } from 'graphql-sse';
import type { ConnectionState, ClientEvent, ChannelEvent, RoolEventSource, RoolObject, RoolObjectStat, SpaceSchema, Channel, Conversation, ExtensionManifest } from './types.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;
const HEARTBEAT_TIMEOUT = 5_000; // Server sends heartbeats every 2s; reconnect if no message within 5s
const HEARTBEAT_CHECK_INTERVAL = 1_000;

// =============================================================================
// Subscription<TEvent>
// Owns one GraphQL SSE subscription: auth, auto-reconnect with backoff,
// heartbeat watchdog, online-event handling. The state machine is documented
// in SUBSCRIPTION.md — keep that file in sync when changing behavior here.
// =============================================================================

interface SubscriptionConfig<TEvent> {
  graphqlUrl: string;
  authManager: AuthManager;
  logger: Logger;
  logPrefix: string;
  query: string;
  variables?: Record<string, unknown>;
  dataField: string;
  parseEvent: (raw: Record<string, unknown>) => TEvent | null;
  isConnectedEvent: (event: TEvent) => boolean;
  onEvent: (event: TEvent) => void;
  onConnectionStateChanged: (state: ConnectionState) => void;
  onError: (error: Error) => void;
}

type Tokens = { accessToken: string; roolToken: string };

type State =
  | { kind: 'idle' }
  | { kind: 'awaiting_auth' }
  | { kind: 'probing'; client: Client; unsubscribe: () => void; watchdog: ReturnType<typeof setInterval> }
  | { kind: 'live'; client: Client; unsubscribe: () => void; watchdog: ReturnType<typeof setInterval> }
  | { kind: 'backoff'; timer: ReturnType<typeof setTimeout> }
  | { kind: 'closed' };

type Input =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'auth_resolved'; tokens: Tokens }
  | { kind: 'auth_failed'; error: Error }
  | { kind: 'message_received'; raw: Record<string, unknown> }
  | { kind: 'watchdog_stale' }
  | { kind: 'backoff_fired' }
  | { kind: 'online_event' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class Subscription<TEvent> {
  private config: SubscriptionConfig<TEvent>;
  private state: State = { kind: 'idle' };
  private backoffDelay = INITIAL_RECONNECT_DELAY;
  private lastMessageAt = 0;
  private initDeferred: Deferred<void> | null = null;
  private boundOnlineHandler: (() => void) | null = null;

  constructor(config: SubscriptionConfig<TEvent>) {
    this.config = config;
  }

  get isLive(): boolean {
    return this.state.kind === 'live';
  }

  start(): Promise<void> {
    if (this.state.kind === 'live') return Promise.resolve();
    if (this.state.kind === 'closed') return Promise.reject(new Error('Subscription is closed'));
    if (this.initDeferred) return this.initDeferred.promise;

    this.initDeferred = makeDeferred<void>();

    if (this.state.kind === 'idle') {
      this.listenForOnline();
      this.handle({ kind: 'start' });
    }
    // Otherwise the subscription is already running (backoff/awaiting_auth/probing)
    // and the new deferred will resolve/reject on the next terminal transition.

    return this.initDeferred.promise;
  }

  stop(): void {
    this.handle({ kind: 'stop' });
  }

  // ===========================================================================
  // State machine — the only place this.state is written.
  // ===========================================================================

  private handle(input: Input): void {
    const state = this.state;
    switch (input.kind) {
      case 'start':
        if (state.kind !== 'idle') return;
        this.enterAwaitingAuth();
        return;

      case 'stop':
        if (state.kind === 'closed') return;
        this.enterClosed();
        return;

      case 'auth_resolved':
        if (state.kind !== 'awaiting_auth') return;
        this.enterProbing(input.tokens);
        return;

      case 'auth_failed':
        if (state.kind !== 'awaiting_auth') return;
        this.config.onError(input.error);
        this.rejectInitIfPending(input.error);
        this.enterBackoff();
        return;

      case 'message_received':
        if (state.kind !== 'probing' && state.kind !== 'live') return;
        this.handleMessage(input.raw);
        return;

      case 'watchdog_stale':
        if (state.kind !== 'probing' && state.kind !== 'live') return;
        this.config.logger.info(`${this.config.logPrefix} heartbeat timeout`);
        this.rejectInitIfPending(new Error('Heartbeat timeout'));
        this.backoffDelay = INITIAL_RECONNECT_DELAY;
        this.enterBackoff();
        return;

      case 'backoff_fired':
        if (state.kind !== 'backoff') return;
        this.enterAwaitingAuth();
        return;

      case 'online_event':
        if (state.kind === 'closed') return;
        this.backoffDelay = INITIAL_RECONNECT_DELAY;
        return;
    }
  }

  // ===========================================================================
  // State entry functions.
  // INVARIANT: update this.state BEFORE any side effects so that re-entrant
  // callbacks (e.g., graphql-sse firing complete inside unsubscribe()) observe
  // the new state and no-op.
  // ===========================================================================

  private enterAwaitingAuth(): void {
    // From idle or backoff.
    const prev = this.state;
    if (prev.kind === 'backoff') {
      clearTimeout(prev.timer);
    }
    this.state = { kind: 'awaiting_auth' };
    this.config.onConnectionStateChanged('reconnecting');

    this.config.authManager.getTokens().then(
      (tokens) => {
        if (tokens) this.handle({ kind: 'auth_resolved', tokens });
        else this.handle({ kind: 'auth_failed', error: new Error('Not authenticated') });
      },
      (err: unknown) => {
        this.handle({ kind: 'auth_failed', error: err instanceof Error ? err : new Error(String(err)) });
      },
    );
  }

  private enterProbing(tokens: Tokens): void {
    // From awaiting_auth. The watchdog is the sole liveness detector: every
    // failure mode manifests as heartbeats no longer arriving, and the
    // watchdog fires watchdog_stale within HEARTBEAT_TIMEOUT.
    let client: Client;
    try {
      client = createClient({
        url: this.config.graphqlUrl,
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'X-Rool-Token': tokens.roolToken,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.logger.error(`${this.config.logPrefix} failed to create client:`, err);
      this.config.onError(err);
      this.rejectInitIfPending(err);
      this.enterBackoff();
      return;
    }

    this.lastMessageAt = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT) {
        this.handle({ kind: 'watchdog_stale' });
      }
    }, HEARTBEAT_CHECK_INTERVAL);

    // Indirect unsubscribe so state can be set before client.subscribe() is
    // called, even though the real unsubscribe fn isn't available until it
    // returns.
    let realUnsubscribe: () => void = () => {};
    const unsubscribe = () => realUnsubscribe();

    this.state = { kind: 'probing', client, unsubscribe, watchdog };
    this.config.logger.info(`${this.config.logPrefix} connecting...`);

    realUnsubscribe = client.subscribe(
      { query: this.config.query, variables: this.config.variables },
      {
        next: (result) => {
          const data = result.data?.[this.config.dataField];
          if (typeof data !== 'string') return;
          let raw: Record<string, unknown>;
          try {
            raw = JSON.parse(data) as Record<string, unknown>;
          } catch (e) {
            this.config.logger.error(`${this.config.logPrefix} failed to parse event:`, e);
            return;
          }
          this.handle({ kind: 'message_received', raw });
        },
        // error/complete intentionally not observed.
        error: () => {},
        complete: () => {},
      },
    );
  }

  private enterBackoff(): void {
    // From awaiting_auth (after auth_failed) or probing/live (after watchdog_stale).
    const prev = this.state;

    const delay = this.backoffDelay;
    const timer = setTimeout(() => this.handle({ kind: 'backoff_fired' }), delay);
    this.state = { kind: 'backoff', timer };
    this.backoffDelay = Math.min(this.backoffDelay * RECONNECT_MULTIPLIER, MAX_RECONNECT_DELAY);
    this.config.logger.info(`${this.config.logPrefix} reconnecting in ${delay}ms...`);

    if (prev.kind === 'probing' || prev.kind === 'live') {
      this.config.onConnectionStateChanged('disconnected');
      this.tearDown(prev);
      this.config.onConnectionStateChanged('reconnecting');
    }
    // awaiting_auth → backoff: consumer was already in 'reconnecting', no emission.
  }

  private enterClosed(): void {
    // From any non-closed state.
    const prev = this.state;
    this.state = { kind: 'closed' };

    switch (prev.kind) {
      case 'probing':
      case 'live':
        this.config.onConnectionStateChanged('disconnected');
        this.tearDown(prev);
        break;
      case 'backoff':
        clearTimeout(prev.timer);
        this.config.onConnectionStateChanged('disconnected');
        break;
      case 'awaiting_auth':
        this.config.onConnectionStateChanged('disconnected');
        break;
      case 'idle':
      case 'closed':
        break;
    }

    this.removeOnlineListener();
    this.rejectInitIfPending(new Error('Subscription stopped before connected'));
  }

  private handleMessage(raw: Record<string, unknown>): void {
    const state = this.state;
    if (state.kind !== 'probing' && state.kind !== 'live') return;

    // Every message (including heartbeats) counts for liveness and backoff reset.
    this.lastMessageAt = Date.now();
    this.backoffDelay = INITIAL_RECONNECT_DELAY;

    const event = this.config.parseEvent(raw);
    if (!event) return;

    if (state.kind === 'probing' && this.config.isConnectedEvent(event)) {
      this.state = {
        kind: 'live',
        client: state.client,
        unsubscribe: state.unsubscribe,
        watchdog: state.watchdog,
      };
      this.config.logger.info(`${this.config.logPrefix} connected`);
      this.config.onConnectionStateChanged('connected');
      if (this.initDeferred) {
        const { resolve } = this.initDeferred;
        this.initDeferred = null;
        resolve();
      }
    }

    this.config.onEvent(event);
  }

  // ===========================================================================
  // Helpers.
  // ===========================================================================

  private tearDown(prev: { client: Client; unsubscribe: () => void; watchdog: ReturnType<typeof setInterval> }): void {
    clearInterval(prev.watchdog);
    try {
      prev.unsubscribe();
    } catch (e) {
      this.config.logger.warn(`${this.config.logPrefix} unsubscribe threw:`, e);
    }
  }

  private rejectInitIfPending(error: Error): void {
    if (!this.initDeferred) return;
    const { reject } = this.initDeferred;
    this.initDeferred = null;
    reject(error);
  }

  private listenForOnline(): void {
    if (typeof window === 'undefined') return;
    if (this.boundOnlineHandler) return;
    this.boundOnlineHandler = () => this.handle({ kind: 'online_event' });
    window.addEventListener('online', this.boundOnlineHandler);
  }

  private removeOnlineListener(): void {
    if (typeof window === 'undefined') return;
    if (!this.boundOnlineHandler) return;
    window.removeEventListener('online', this.boundOnlineHandler);
    this.boundOnlineHandler = null;
  }
}

// =============================================================================
// Client Subscription Manager
// Handles client-level events (space created, deleted, renamed, etc.)
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
  private subscription: Subscription<ClientEvent>;

  constructor(config: ClientSubscriptionConfig) {
    this.subscription = new Subscription<ClientEvent>({
      graphqlUrl: config.graphqlUrl,
      authManager: config.authManager,
      logger: config.logger,
      logPrefix: '[RoolClient]',
      query: `
        subscription ClientEvents {
          clientEvents
        }
      `,
      dataField: 'clientEvents',
      parseEvent: (raw) => parseClientEvent(raw, config.logger),
      isConnectedEvent: (event) => event.type === 'connected',
      onEvent: config.onEvent,
      onConnectionStateChanged: config.onConnectionStateChanged,
      onError: config.onError,
    });
  }

  async subscribe(): Promise<void> {
    await this.subscription.start();
  }

  destroy(): void {
    this.subscription.stop();
  }
}

function parseClientEvent(raw: Record<string, unknown>, logger: Logger): ClientEvent | null {
  if (raw.type === 'heartbeat') return null;
  const type = raw.type as ClientEvent['type'];
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
      logger.warn('[RoolClient] Unknown client event type:', type);
      return null;
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
  private subscription: Subscription<ChannelEvent>;

  constructor(config: SpaceSubscriptionConfig) {
    this.subscription = new Subscription<ChannelEvent>({
      graphqlUrl: config.graphqlUrl,
      authManager: config.authManager,
      logger: config.logger,
      logPrefix: `[RoolChannel] Space ${config.spaceId}`,
      query: `
        subscription SpaceEvents($spaceId: String!) {
          spaceEvents(spaceId: $spaceId)
        }
      `,
      variables: { spaceId: config.spaceId },
      dataField: 'spaceEvents',
      parseEvent: (raw) => parseSpaceEvent(raw, config.logger),
      isConnectedEvent: (event) => event.type === 'connected',
      onEvent: config.onEvent,
      onConnectionStateChanged: config.onConnectionStateChanged,
      onError: config.onError,
    });
  }

  async subscribe(): Promise<void> {
    await this.subscription.start();
  }

  destroy(): void {
    this.subscription.stop();
  }
}

function parseSpaceEvent(raw: Record<string, unknown>, logger: Logger): ChannelEvent | null {
  if (raw.type === 'heartbeat') return null;
  const type = raw.type as ChannelEvent['type'];
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
      logger.warn('[RoolChannel] Unknown space event type:', type);
      return null;
  }
}
