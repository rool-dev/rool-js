/**
 * @rool-dev/app/host — Host-side bridge for iframe-sandboxed apps.
 *
 * The host creates a `BridgeHost` with a real `BridgeableChannel` and an iframe.
 * It handles the handshake, proxies method calls, and forwards events.
 *
 * Used by both the console's AppHost component and the local dev shell.
 */

import type { BridgeRequest, BridgeInit } from './protocol.js';
import { isBridgeMessage } from './protocol.js';

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
}

// Channel events to forward to the app
const FORWARDED_EVENTS = [
  'objectCreated',
  'objectUpdated',
  'objectDeleted',
  'metadataUpdated',
  'channelUpdated',
  'reset',
  'syncError',
] as const;

// Channel methods the app can call.
// Sync methods (getObjectIds, getSchema, etc.) are wrapped as async on the host side.
const ALLOWED_METHODS = new Set([
  'getObject',
  'stat',
  'findObjects',
  'getObjectIds',
  'createObject',
  'updateObject',
  'deleteObjects',
  'getSchema',
  'createCollection',
  'alterCollection',
  'dropCollection',
  'getInteractions',
  'getSystemInstruction',
  'setSystemInstruction',
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
]);

export interface BridgeHostOptions {
  /** The real channel to proxy calls to */
  channel: BridgeableChannel;
  /** The iframe element hosting the app */
  iframe: HTMLIFrameElement;
}

export class BridgeHost {
  private channel: BridgeableChannel;
  private iframe: HTMLIFrameElement;
  private eventCleanups: Array<() => void> = [];
  private _destroyed = false;

  constructor(options: BridgeHostOptions) {
    this.channel = options.channel;
    this.iframe = options.iframe;

    window.addEventListener('message', this._onMessage);

    // Forward channel events to the app iframe
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
  };

  private async _handleRequest(req: BridgeRequest): Promise<void> {
    const { id, method, args } = req;

    if (!ALLOWED_METHODS.has(method)) {
      this._postToApp({
        type: 'rool:response',
        id,
        error: `Method "${method}" is not available to apps`,
      });
      return;
    }

    try {
      // Get the method from the channel (cast for dynamic dispatch)
      const fn = (this.channel as unknown as Record<string, unknown>)[method];
      let result: unknown;

      if (typeof fn === 'function') {
        result = fn.apply(this.channel, args);
        // Await if it returns a promise
        if (result instanceof Promise) {
          result = await result;
        }
      } else {
        // Property access (shouldn't happen with current ALLOWED_METHODS, but just in case)
        result = fn;
      }

      this._postToApp({ type: 'rool:response', id, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this._postToApp({ type: 'rool:response', id, error: message });
    }
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
