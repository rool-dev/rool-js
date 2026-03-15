/**
 * App-side bridge client.
 *
 * `initApp()` waits for the host handshake, then returns an `AppChannel`
 * that mirrors the RoolChannel API over postMessage.
 */

import type { BridgeInit, BridgeResponse, BridgeEvent } from './protocol.js';
import { isBridgeMessage } from './protocol.js';
import type {
  RoolObject,
  RoolObjectStat,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  Interaction,
  PromptOptions,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  RoolUserRole,
  LinkAccess,
  AppChannelEvents,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 0;
function nextRequestId(): string {
  return `req-${++_nextId}-${Date.now().toString(36)}`;
}

type EventName = keyof AppChannelEvents;
type EventCallback = (...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// AppChannel
// ---------------------------------------------------------------------------

export class AppChannel {
  private _pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _listeners = new Map<string, Set<EventCallback>>();

  // Metadata from handshake
  readonly channelId: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly role: RoolUserRole;
  readonly linkAccess: LinkAccess;
  readonly userId: string;

  private _schema: SpaceSchema;
  private _metadata: Record<string, unknown>;

  constructor(init: BridgeInit) {
    this.channelId = init.channelId;
    this.spaceId = init.spaceId;
    this.spaceName = init.spaceName;
    this.role = init.role as RoolUserRole;
    this.linkAccess = init.linkAccess as LinkAccess;
    this.userId = init.userId;
    this._schema = init.schema as SpaceSchema;
    this._metadata = init.metadata;

    window.addEventListener('message', this._onMessage);
  }

  get isReadOnly(): boolean {
    return this.role === 'viewer';
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  on<E extends EventName>(event: E, callback: (data: AppChannelEvents[E]) => void): void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(callback as EventCallback);
  }

  off<E extends EventName>(event: E, callback: (data: AppChannelEvents[E]) => void): void {
    this._listeners.get(event)?.delete(callback as EventCallback);
  }

  private _emit(event: string, data: unknown): void {
    const set = this._listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[AppChannel] Error in ${event} listener:`, e);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // postMessage transport
  // ---------------------------------------------------------------------------

  private _call(method: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextRequestId();
      this._pending.set(id, { resolve, reject });
      window.parent.postMessage(
        { type: 'rool:request', id, method, args },
        '*',
      );
    });
  }

  private _onMessage = (event: MessageEvent): void => {
    if (!isBridgeMessage(event.data)) return;

    if (event.data.type === 'rool:response') {
      const msg = event.data as BridgeResponse;
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (event.data.type === 'rool:event') {
      const msg = event.data as BridgeEvent;

      // Update local caches before emitting so listeners see fresh data
      if (msg.name === 'metadataUpdated') {
        const payload = msg.data as { metadata: Record<string, unknown> };
        this._metadata = payload.metadata;
      } else if (msg.name === 'schemaUpdated') {
        const payload = msg.data as { schema: Record<string, unknown> };
        this._schema = payload.schema as SpaceSchema;
      }

      this._emit(msg.name, msg.data);
      return;
    }
  };

  // ---------------------------------------------------------------------------
  // Channel API — mirrors RoolChannel
  // ---------------------------------------------------------------------------

  // Object operations

  async getObject(objectId: string): Promise<RoolObject | undefined> {
    return this._call('getObject', objectId) as Promise<RoolObject | undefined>;
  }

  async stat(objectId: string): Promise<RoolObjectStat | undefined> {
    return this._call('stat', objectId) as Promise<RoolObjectStat | undefined>;
  }

  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    return this._call('findObjects', options) as Promise<{ objects: RoolObject[]; message: string }>;
  }

  async getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }): Promise<string[]> {
    return this._call('getObjectIds', options) as Promise<string[]>;
  }

  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._call('createObject', options) as Promise<{ object: RoolObject; message: string }>;
  }

  async updateObject(objectId: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this._call('updateObject', objectId, options) as Promise<{ object: RoolObject; message: string }>;
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    await this._call('deleteObjects', objectIds);
  }

  // Schema

  getSchema(): SpaceSchema {
    return this._schema;
  }

  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    const result = await this._call('createCollection', name, fields) as CollectionDef;
    this._schema[name] = result;
    return result;
  }

  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    const result = await this._call('alterCollection', name, fields) as CollectionDef;
    this._schema[name] = result;
    return result;
  }

  async dropCollection(name: string): Promise<void> {
    await this._call('dropCollection', name);
    delete this._schema[name];
  }

  // Interactions & system instruction

  async getInteractions(): Promise<Interaction[]> {
    return this._call('getInteractions') as Promise<Interaction[]>;
  }

  async getSystemInstruction(): Promise<string | undefined> {
    return this._call('getSystemInstruction') as Promise<string | undefined>;
  }

  async setSystemInstruction(instruction: string | null): Promise<void> {
    await this._call('setSystemInstruction', instruction);
  }

  // Metadata

  async setMetadata(key: string, value: unknown): Promise<void> {
    await this._call('setMetadata', key, value);
    this._metadata[key] = value;
  }

  getMetadata(key: string): unknown {
    return this._metadata[key];
  }

  getAllMetadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  // AI

  async prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }> {
    return this._call('prompt', text, options) as Promise<{ message: string; objects: RoolObject[] }>;
  }

  // Undo/redo

  async checkpoint(label?: string): Promise<string> {
    return this._call('checkpoint', label) as Promise<string>;
  }

  async canUndo(): Promise<boolean> {
    return this._call('canUndo') as Promise<boolean>;
  }

  async canRedo(): Promise<boolean> {
    return this._call('canRedo') as Promise<boolean>;
  }

  async undo(): Promise<boolean> {
    return this._call('undo') as Promise<boolean>;
  }

  async redo(): Promise<boolean> {
    return this._call('redo') as Promise<boolean>;
  }

  async clearHistory(): Promise<void> {
    await this._call('clearHistory');
  }

  // Cleanup

  destroy(): void {
    window.removeEventListener('message', this._onMessage);
    for (const { reject } of this._pending.values()) {
      reject(new Error('AppChannel destroyed'));
    }
    this._pending.clear();
    this._listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// initApp
// ---------------------------------------------------------------------------

/**
 * Initialize the app bridge. Call this once at startup.
 *
 * Sends `rool:ready` to the host and waits for `rool:init` with channel metadata.
 * Returns an `AppChannel` that mirrors the RoolChannel API over postMessage.
 *
 * @param timeout - How long to wait for the handshake (ms). Default: 10000.
 */
export function initApp(timeout = 10000): Promise<AppChannel> {
  return new Promise<AppChannel>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('App handshake timed out — is this running inside a Rool host?'));
    }, timeout);

    function onMessage(event: MessageEvent): void {
      if (!isBridgeMessage(event.data) || event.data.type !== 'rool:init') return;

      clearTimeout(timer);
      window.removeEventListener('message', onMessage);

      const channel = new AppChannel(event.data as BridgeInit);
      resolve(channel);
    }

    window.addEventListener('message', onMessage);

    // Signal to the host that we're ready
    window.parent.postMessage({ type: 'rool:ready' }, '*');
  });
}
