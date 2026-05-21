/**
 * @rool-dev/extension/host — Host-side bridge for iframe-sandboxed extensions.
 *
 * The host creates a `BridgeHost` with a real `BridgeableChannel` and an iframe.
 * It handles the handshake, proxies method calls, and forwards events.
 *
 * Used by both the console's ExtensionHost component and the local dev shell.
 */

import type { BridgeRequest, BridgeInit, BridgeUser, ColorScheme, BridgeProbeResult } from './protocol.js';
import { isBridgeMessage } from './protocol.js';

export { FsChannel } from './fs-channel.js';
export type { FsChannelOptions, FsOverview } from './fs-channel.js';

/**
 * Minimal channel interface accepted by the bridge host.
 * Works with both BridgeableChannel (SDK) and ReactiveChannel (@rool-dev/svelte).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BridgeableChannel {
  id: string;
  name: string;
  role: string;
  linkAccess: string;
  userId: string;
  channelId: string;
  getSchema(): Record<string, unknown>;
  getAllMetadata(): Record<string, unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  conversation(conversationId: string): unknown;
}

// Channel events to forward to the extension
const FORWARDED_EVENTS = [
  'objectCreated',
  'objectUpdated',
  'objectDeleted',
  'objectMoved',
  'metadataUpdated',
  'schemaUpdated',
  'channelUpdated',
  'conversationUpdated',
  'reset',
  'syncError',
] as const;

// Channel methods the extension can call.
// Sync methods (getObjectLocations, getSchema, etc.) are wrapped as async on the host side.
const ALLOWED_METHODS = new Set([
  'getObject',
  'stat',
  'findObjects',
  'getObjectLocations',
  'createObject',
  'updateObject',
  'moveObject',
  'deleteObjects',
  'getSchema',
  'createCollection',
  'alterCollection',
  'dropCollection',
  'getInteractions',
  'getTree',
  'setActiveLeaf',
  'getActiveLeafId',
  'getConversations',
  'getSystemInstruction',
  'setSystemInstruction',
  'deleteConversation',
  'renameConversation',
  'setMetadata',
  'getMetadata',
  'getAllMetadata',
  'prompt',
  'checkpoint',
  'canUndo',
  'canRedo',
  'undo',
  'redo',
  'clearHistory',
  'fetch',
]);

// Methods that can be dispatched to a ConversationHandle when conversationId is present
const CONVERSATION_METHODS = new Set([
  'getInteractions',
  'getTree',
  'setActiveLeaf',
  'getActiveLeafId',
  'getSystemInstruction',
  'setSystemInstruction',
  'renameConversation',
  'findObjects',
  'createObject',
  'updateObject',
  'moveObject',
  'deleteObjects',
  'prompt',
  'createCollection',
  'alterCollection',
  'dropCollection',
  'setMetadata',
]);

// Wire method names that differ on ConversationHandle
const CONVERSATION_METHOD_MAP: Record<string, string> = {
  'renameConversation': 'rename',
};

// Wire method names that map to getters (not callable methods)
const GETTER_MAP: Record<string, string> = {
  'getActiveLeafId': 'activeLeafId',
};

export interface BridgeHostOptions {
  /** The real channel to proxy calls to */
  channel: BridgeableChannel;
  /** The iframe element hosting the extension */
  iframe: HTMLIFrameElement;
  /** Current user info to expose to the extension */
  user: BridgeUser;
  /** Resolved color scheme to send to the extension. Defaults to 'light'. */
  colorScheme?: ColorScheme;
}

export class BridgeHost {
  private channel: BridgeableChannel;
  private iframe: HTMLIFrameElement;
  private user: BridgeUser;
  private _colorScheme: ColorScheme;
  private eventCleanups: Array<() => void> = [];
  private _destroyed = false;
  private _pendingProbes = new Map<string, {
    resolve: (result: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private _nextProbeId = 0;

  constructor(options: BridgeHostOptions) {
    this.channel = options.channel;
    this.iframe = options.iframe;
    this.user = options.user;
    this._colorScheme = options.colorScheme ?? 'light';

    window.addEventListener('message', this._onMessage);

    // Forward channel events to the extension iframe
    for (const eventName of FORWARDED_EVENTS) {
      const handler = (data: unknown) => {
        this._postToApp({
          type: 'rool:event',
          name: eventName,
          data,
        });
      };
      this.channel.on(eventName, handler);
      this.eventCleanups.push(() => {
        this.channel.off(eventName, handler);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------------

  private _sendInit(): void {
    const init: BridgeInit = {
      type: 'rool:init',
      channelId: this.channel.channelId,
      spaceId: this.channel.id,
      spaceName: this.channel.name,
      role: this.channel.role,
      linkAccess: this.channel.linkAccess,
      userId: this.channel.userId,
      user: this.user,
      colorScheme: this._colorScheme,
      schema: this.channel.getSchema(),
      metadata: this.channel.getAllMetadata(),
    };
    this._postToApp(init);
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private _onMessage = async (event: MessageEvent): Promise<void> => {
    // Only accept messages from our iframe
    if (event.source !== this.iframe.contentWindow) return;
    if (!isBridgeMessage(event.data)) return;

    if (event.data.type === 'rool:ready') {
      this._sendInit();
      return;
    }

    if (event.data.type === 'rool:request') {
      await this._handleRequest(event.data as BridgeRequest);
      return;
    }

    if (event.data.type === 'rool:probeResult') {
      this._handleProbeResult(event.data as BridgeProbeResult);
      return;
    }
  };

  private _handleProbeResult(msg: BridgeProbeResult): void {
    const pending = this._pendingProbes.get(msg.id);
    if (!pending) return;
    this._pendingProbes.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async _handleRequest(req: BridgeRequest): Promise<void> {
    const { id, method, args, conversationId } = req;

    if (!ALLOWED_METHODS.has(method)) {
      this._postToApp({
        type: 'rool:response',
        id,
        error: `Method "${method}" is not available to extensions`,
      });
      return;
    }

    try {
      // Determine the target: conversation handle or channel
      let target: unknown = this.channel;
      let methodName = method;

      if (conversationId !== undefined && CONVERSATION_METHODS.has(method)) {
        target = this.channel.conversation(conversationId);
        methodName = CONVERSATION_METHOD_MAP[method] ?? method;
      }

      // Resolve getter aliases (e.g. getActiveLeafId → activeLeafId)
      if (GETTER_MAP[methodName]) {
        methodName = GETTER_MAP[methodName];
      }

      // Get the method from the target (cast for dynamic dispatch)
      const fn = (target as Record<string, unknown>)[methodName];
      let result: unknown;

      if (typeof fn === 'function') {
        result = fn.apply(target, args);
        // Await if it returns a promise
        if (result instanceof Promise) {
          result = await result;
        }
      } else {
        // Property access (shouldn't happen with current ALLOWED_METHODS, but just in case)
        result = fn;
      }

      // Response objects can't be serialized over postMessage — convert to a plain object
      // Uses ArrayBuffer (transferable) to support both text and binary responses.
      if (method === 'fetch' && result instanceof Response) {
        const response = result;
        const headers: Record<string, string> = {};
        response.headers.forEach((v, k) => { headers[k] = v; });
        const body = await response.arrayBuffer();
        result = { status: response.status, statusText: response.statusText, headers, body };
      }

      this._postToApp({ type: 'rool:response', id, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this._postToApp({ type: 'rool:response', id, error: message });
    }
  }

  // ---------------------------------------------------------------------------
  // Color scheme
  // ---------------------------------------------------------------------------

  /**
   * Run an agent-initiated probe operation against the iframe (e.g. screenshot,
   * console-log dump, click-by-selector). The extension's probe handler table
   * dispatches by `method`. Resolves with the method-specific result, rejects
   * with the iframe's reported error or on timeout.
   */
  probe<T = unknown>(method: string, args: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this._destroyed) {
        reject(new Error('BridgeHost is destroyed'));
        return;
      }
      const id = `probe-${++this._nextProbeId}-${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        this._pendingProbes.delete(id);
        reject(new Error(`Probe "${method}" timed out`));
      }, timeoutMs);
      this._pendingProbes.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });
      this._postToApp({ type: 'rool:probe', id, method, args });
    });
  }

  /** Update the color scheme and push to the extension iframe. */
  setColorScheme(colorScheme: ColorScheme): void {
    this._colorScheme = colorScheme;
    this._postToApp({ type: 'rool:event', name: 'colorSchemeChanged', data: { colorScheme } });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _postToApp(message: object): void {
    if (this._destroyed) return;
    this.iframe.contentWindow?.postMessage(message, '*');
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this._destroyed = true;
    window.removeEventListener('message', this._onMessage);
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups = [];
    for (const pending of this._pendingProbes.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('BridgeHost destroyed'));
    }
    this._pendingProbes.clear();
  }
}

/**
 * Create a bridge host that proxies a BridgeableChannel to an iframe.
 *
 * @example
 * ```typescript
 * const host = createBridgeHost({ channel, iframe });
 * // ... later
 * host.destroy();
 * ```
 */
export function createBridgeHost(options: BridgeHostOptions): BridgeHost {
  return new BridgeHost(options);
}
