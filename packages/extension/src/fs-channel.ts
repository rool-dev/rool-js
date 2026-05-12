/**
 * FsChannel — a BridgeableChannel backed by the in-VM /space FUSE projection.
 *
 * All data ops translate to HTTP calls against a small "space proxy" served
 * by the preview daemon on the same origin. The proxy forwards to the in-VM
 * rool-space-api.py, injecting bearer auth and actor headers server-side.
 * Reactivity comes from an SSE stream the daemon pushes whenever it sees
 * /space change.
 *
 * Conversations / interactions are kept in memory: /space doesn't expose
 * them. Out of scope (throws / no-ops): AI prompts, checkpoint/undo/redo,
 * server-proxied fetch.
 */
import type {
  Channel,
  Conversation,
  ConversationInfo,
  Interaction,
  LinkAccess,
  RoolObject,
  RoolObjectStat,
  RoolUserRole,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
} from '@rool-dev/sdk';
import type { BridgeableChannel } from './host.js';

interface FsObjectStat {
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInChannel: string;
  modifiedInConversation: string | null;
  modifiedInInteraction: string | null;
}

export interface FsOverview {
  objectIds: string[];
  objectStats: Array<{ id: string } & FsObjectStat>;
  schema: SpaceSchema;
  meta: Record<string, unknown>;
}

export interface FsChannelOptions {
  /** Base URL of the space proxy, e.g. '/__rool-host/space'. */
  baseUrl: string;
  /** Space id (must match what the daemon was started for). */
  spaceId: string;
  /** Space name shown to the extension. */
  spaceName: string;
  /** Channel id this view operates against. */
  channelId: string;
  /** Pre-fetched overview, used to seed the in-memory caches. */
  overview: FsOverview;
  /** User id to attribute mutations to. Default: 'preview-user'. */
  userId?: string;
  /** Role exposed to the extension. Default: 'editor'. */
  role?: RoolUserRole;
  /** Link access exposed to the extension. Default: 'none'. */
  linkAccess?: LinkAccess;
  /** Conversation id to bind this view to. Default: 'default'. */
  conversationId?: string;
}

const DEFAULT_CONVERSATION_ID = 'default';
const ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function generateEntityId(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return s;
}

type Listener = (data: unknown) => void;

class TinyEmitter {
  private listeners = new Map<string, Set<Listener>>();
  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
  }
  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(data);
  }
}

interface ServerEvent {
  type: 'objectChanged' | 'objectDeleted' | 'schemaChanged' | 'metaChanged';
  objectId?: string;
  collection?: string;
  object?: Record<string, unknown>;
  stat?: FsObjectStat;
  schema?: SpaceSchema;
  meta?: Record<string, unknown>;
}

export class FsChannel implements BridgeableChannel {
  readonly id: string;
  readonly name: string;
  readonly role: RoolUserRole;
  readonly linkAccess: LinkAccess;
  readonly userId: string;
  readonly channelId: string;

  private baseUrl: string;
  private conversationId: string;
  private channel: Channel;
  private schema: SpaceSchema;
  private meta: Record<string, unknown>;
  private statsById = new Map<string, FsObjectStat>();
  private activeLeaves = new Map<string, string>();
  private emitter = new TinyEmitter();
  private events: EventSource | null = null;

  constructor(opts: FsChannelOptions) {
    this.id = opts.spaceId;
    this.name = opts.spaceName;
    this.role = opts.role ?? 'editor';
    this.linkAccess = opts.linkAccess ?? 'none';
    this.userId = opts.userId ?? 'preview-user';
    this.channelId = opts.channelId;
    this.conversationId = opts.conversationId ?? DEFAULT_CONVERSATION_ID;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');

    this.schema = opts.overview.schema;
    this.meta = opts.overview.meta;
    for (const stat of opts.overview.objectStats) {
      const { id, ...rest } = stat;
      this.statsById.set(id, rest);
    }
    this.channel = {
      createdAt: Date.now(),
      createdBy: this.userId,
      conversations: {},
    };

    this.subscribeToEvents();
  }

  // --- HTTP helpers -----------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}/v1/spaces/${encodeURIComponent(this.id)}${path}`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: unknown;
    const text = await res.text();
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    if (!res.ok) {
      const errMsg = (parsed && typeof parsed === 'object' && 'error' in parsed)
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
      throw new Error(errMsg);
    }
    return parsed as T;
  }

  // --- Event stream -----------------------------------------------------

  private subscribeToEvents(): void {
    if (typeof EventSource === 'undefined') return;
    const url = `${this.baseUrl}/events`;
    this.events = new EventSource(url);
    this.events.onmessage = (ev) => {
      let parsed: ServerEvent;
      try { parsed = JSON.parse(ev.data) as ServerEvent; } catch { return; }
      this.handleServerEvent(parsed);
    };
    this.events.onerror = () => {
      // EventSource auto-reconnects; surface a syncError but keep the
      // subscription alive.
      this.emitter.emit('syncError', new Error('Preview event stream disconnected'));
    };
  }

  private handleServerEvent(ev: ServerEvent): void {
    if (ev.type === 'objectChanged' && ev.objectId && ev.object && ev.stat) {
      const wasKnown = this.statsById.has(ev.objectId);
      const prev = this.statsById.get(ev.objectId);
      // Idempotent: skip if the stamp we already have is at least as recent.
      if (prev && prev.modifiedAt >= ev.stat.modifiedAt) return;
      this.statsById.set(ev.objectId, ev.stat);
      const name = wasKnown ? 'objectUpdated' : 'objectCreated';
      this.emitter.emit(name, {
        objectId: ev.objectId,
        object: ev.object as RoolObject,
        source: 'remote_agent',
      });
      return;
    }
    if (ev.type === 'objectDeleted' && ev.objectId) {
      if (!this.statsById.has(ev.objectId)) return;
      this.statsById.delete(ev.objectId);
      this.emitter.emit('objectDeleted', { objectId: ev.objectId, source: 'remote_agent' });
      return;
    }
    if (ev.type === 'schemaChanged' && ev.schema) {
      this.schema = ev.schema;
      this.emitter.emit('schemaUpdated', { schema: this.schema, source: 'remote_agent' });
      return;
    }
    if (ev.type === 'metaChanged' && ev.meta) {
      this.meta = ev.meta;
      this.emitter.emit('metadataUpdated', { metadata: this.meta, source: 'remote_agent' });
      return;
    }
  }

  // --- BridgeableChannel surface ----------------------------------------

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.on(event, handler as Listener);
  }
  off(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler as Listener);
  }

  conversation(conversationId: string): unknown {
    return new FsConversationHandle(this, conversationId);
  }

  destroy(): void {
    if (this.events) {
      this.events.close();
      this.events = null;
    }
  }

  // --- Object reads -----------------------------------------------------

  async getObject(objectId: string): Promise<RoolObject | undefined> {
    try {
      const body = await this.req<Record<string, unknown>>('GET', `/objects/${encodeURIComponent(objectId)}`);
      return body as RoolObject;
    } catch (e) {
      if (e instanceof Error && /OBJECT_NOT_FOUND/.test(e.message)) return undefined;
      throw e;
    }
  }

  stat(objectId: string): RoolObjectStat | undefined {
    const s = this.statsById.get(objectId);
    if (!s) return undefined;
    return { ...s };
  }

  getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }): string[] {
    const entries = Array.from(this.statsById.entries());
    entries.sort((a, b) => b[1].modifiedAt - a[1].modifiedAt);
    let ids = entries.map(([id]) => id);
    if (options?.order === 'asc') ids = ids.reverse();
    if (options?.limit !== undefined) ids = ids.slice(0, options.limit);
    return ids;
  }

  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    if (options.prompt) {
      throw new Error('findObjects with `prompt` (AI) is not supported in preview');
    }
    const body = await this.req<{ objects: Array<Record<string, unknown>>; count: number }>(
      'POST',
      '/find',
      {
        where: options.where,
        collection: options.collection,
        objectIds: options.objectIds,
        order: options.order ?? 'desc',
        limit: options.limit,
      },
    );
    return {
      objects: body.objects as RoolObject[],
      message: `Found ${body.count} object(s)`,
    };
  }

  // --- Object writes ----------------------------------------------------

  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this.createObjectScoped(options, this.conversationId);
  }

  async createObjectScoped(options: CreateObjectOptions, _conversationId: string): Promise<{ object: RoolObject; message: string }> {
    const data = { ...options.data };
    if (typeof data.id !== 'string' || !data.id) data.id = generateEntityId();
    const objectId = data.id as string;
    await this.req('POST', '/objects', { data });
    const created = (await this.getObject(objectId)) ?? (data as RoolObject);
    this.statsById.set(objectId, this.synthStat());
    this.emitter.emit('objectCreated', { objectId, object: created, source: 'local_user' });
    return { object: created, message: 'Object created' };
  }

  async updateObject(objectId: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this.updateObjectScoped(objectId, options, this.conversationId);
  }

  async updateObjectScoped(objectId: string, options: UpdateObjectOptions, _conversationId: string): Promise<{ object: RoolObject; message: string }> {
    if (options.prompt) {
      throw new Error('updateObject with `prompt` (AI) is not supported in preview');
    }
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    if (options.data) {
      for (const [k, v] of Object.entries(options.data)) {
        if (k === 'id') continue;
        if (v === null || v === undefined) remove.push(k);
        else set[k] = v;
      }
    }
    await this.req('PATCH', `/objects/${encodeURIComponent(objectId)}`, { set, remove });
    const after = await this.getObject(objectId);
    if (!after) throw new Error(`NOT_FOUND: Object "${objectId}" not found`);
    this.statsById.set(objectId, this.synthStat());
    this.emitter.emit('objectUpdated', { objectId, object: after, source: 'local_user' });
    return { object: after, message: 'Object updated' };
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    for (const id of objectIds) {
      if (!this.statsById.has(id)) throw new Error(`NOT_FOUND: Object "${id}" not found`);
    }
    await this.req('POST', '/objects/_delete', { ids: objectIds });
    for (const id of objectIds) {
      this.statsById.delete(id);
      this.emitter.emit('objectDeleted', { objectId: id, source: 'local_user' });
    }
  }

  // --- Schema -----------------------------------------------------------

  getSchema(): SpaceSchema {
    return this.schema;
  }

  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    const res = await this.req<{ name: string; def: CollectionDef }>(
      'POST', '/schema',
      { name, fields },
    );
    this.schema = { ...this.schema, [name]: res.def };
    this.emitter.emit('schemaUpdated', { schema: this.schema, source: 'local_user' });
    return res.def;
  }

  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    const res = await this.req<{ name: string; def: CollectionDef }>(
      'PUT', `/schema/${encodeURIComponent(name)}`,
      { fields },
    );
    this.schema = { ...this.schema, [name]: res.def };
    this.emitter.emit('schemaUpdated', { schema: this.schema, source: 'local_user' });
    return res.def;
  }

  async dropCollection(name: string): Promise<void> {
    await this.req('DELETE', `/schema/${encodeURIComponent(name)}`);
    const next = { ...this.schema };
    delete next[name];
    this.schema = next;
    this.emitter.emit('schemaUpdated', { schema: this.schema, source: 'local_user' });
  }

  // --- Conversation / interactions (in-memory only) ---------------------

  getInteractions(): Interaction[] {
    return this.getInteractionsScoped(this.conversationId);
  }

  getInteractionsScoped(conversationId: string): Interaction[] {
    const conv = this.channel.conversations[conversationId];
    if (!conv) return [];
    const interactions = conv.interactions;
    if (Array.isArray(interactions)) return interactions as Interaction[];
    const leafId = this.getActiveLeafScoped(conversationId);
    if (!leafId) return [];
    const path: Interaction[] = [];
    let cursor: string | null | undefined = leafId;
    while (cursor) {
      const ix: Interaction | undefined = interactions[cursor];
      if (!ix) break;
      path.push(ix);
      cursor = ix.parentId;
    }
    return path.reverse();
  }

  getTree(): Record<string, Interaction> {
    return this.getTreeScoped(this.conversationId);
  }

  getTreeScoped(conversationId: string): Record<string, Interaction> {
    const conv = this.channel.conversations[conversationId];
    if (!conv) return {};
    const ix = conv.interactions;
    if (Array.isArray(ix)) return {};
    return ix;
  }

  get activeLeafId(): string | undefined {
    return this.getActiveLeafScoped(this.conversationId);
  }

  getActiveLeafScoped(conversationId: string): string | undefined {
    const explicit = this.activeLeaves.get(conversationId);
    if (explicit) return explicit;
    const conv = this.channel.conversations[conversationId];
    if (!conv || Array.isArray(conv.interactions)) return undefined;
    const ixs = Object.values(conv.interactions);
    const childSet = new Set<string>();
    for (const ix of ixs) if (ix.parentId) childSet.add(ix.parentId);
    let best: Interaction | undefined;
    for (const ix of ixs) if (!childSet.has(ix.id)) {
      if (!best || ix.timestamp > best.timestamp) best = ix;
    }
    return best?.id;
  }

  setActiveLeaf(interactionId: string): void {
    this.setActiveLeafScoped(interactionId, this.conversationId);
  }

  setActiveLeafScoped(interactionId: string, conversationId: string): void {
    const conv = this.channel.conversations[conversationId];
    if (!conv || Array.isArray(conv.interactions) || !conv.interactions[interactionId]) {
      throw new Error(`Interaction "${interactionId}" not found in conversation "${conversationId}"`);
    }
    this.activeLeaves.set(conversationId, interactionId);
    this.emitter.emit('conversationUpdated', { conversationId, channelId: this.channelId, source: 'local_user' });
  }

  getConversations(): ConversationInfo[] {
    return Object.entries(this.channel.conversations).map(([id, conv]) => ({
      id,
      name: conv.name ?? null,
      systemInstruction: conv.systemInstruction ?? null,
      createdAt: conv.createdAt,
      createdBy: conv.createdBy,
      interactionCount: conv.interactions ? Object.keys(conv.interactions).length : 0,
    }));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (conversationId === this.conversationId) {
      throw new Error('Cannot delete the active conversation');
    }
    if (this.channel.conversations[conversationId]) {
      delete this.channel.conversations[conversationId];
      this.emitter.emit('conversationUpdated', { conversationId, channelId: this.channelId, source: 'local_user' });
    }
  }

  getSystemInstruction(): string | undefined {
    return this.getSystemInstructionScoped(this.conversationId);
  }
  getSystemInstructionScoped(conversationId: string): string | undefined {
    return this.channel.conversations[conversationId]?.systemInstruction;
  }

  async setSystemInstruction(instruction: string | null): Promise<void> {
    return this.setSystemInstructionScoped(instruction, this.conversationId);
  }
  async setSystemInstructionScoped(instruction: string | null, conversationId: string): Promise<void> {
    const conv = this.ensureConversation(conversationId);
    if (instruction === null) delete conv.systemInstruction;
    else conv.systemInstruction = instruction;
    this.emitter.emit('conversationUpdated', { conversationId, channelId: this.channelId, source: 'local_user' });
    if (conversationId === this.conversationId) {
      this.emitter.emit('channelUpdated', { channelId: this.channelId, source: 'local_user' });
    }
  }

  async renameConversation(name: string): Promise<void> {
    return this.renameConversationScoped(name, this.conversationId);
  }
  async renameConversationScoped(name: string, conversationId: string): Promise<void> {
    const conv = this.ensureConversation(conversationId);
    conv.name = name;
    this.emitter.emit('conversationUpdated', { conversationId, channelId: this.channelId, source: 'local_user' });
    if (conversationId === this.conversationId) {
      this.emitter.emit('channelUpdated', { channelId: this.channelId, source: 'local_user' });
    }
  }

  private ensureConversation(conversationId: string): Conversation {
    let conv = this.channel.conversations[conversationId];
    if (!conv) {
      conv = {
        createdAt: Date.now(),
        createdBy: this.userId,
        interactions: {},
      };
      this.channel.conversations[conversationId] = conv;
    }
    return conv;
  }

  // --- Metadata ---------------------------------------------------------

  setMetadata(key: string, value: unknown): void {
    void this.setMetadataScoped(key, value, this.conversationId);
  }
  async setMetadataScoped(key: string, value: unknown, _conversationId: string): Promise<void> {
    const next = { ...this.meta, [key]: value };
    await this.req('PUT', '/meta', { meta: next });
    this.meta = next;
    this.emitter.emit('metadataUpdated', { metadata: this.meta, source: 'local_user' });
  }

  getMetadata(key: string): unknown {
    return this.meta[key];
  }

  getAllMetadata(): Record<string, unknown> {
    return this.meta;
  }

  // --- Out of scope -----------------------------------------------------

  async prompt(): Promise<never> { throw new Error('prompt() not supported in preview'); }
  async checkpoint(): Promise<never> { throw new Error('checkpoint() not supported in preview'); }
  async canUndo(): Promise<boolean> { return false; }
  async canRedo(): Promise<boolean> { return false; }
  async undo(): Promise<boolean> { return false; }
  async redo(): Promise<boolean> { return false; }
  async clearHistory(): Promise<void> { /* no-op */ }
  async fetch(): Promise<never> { throw new Error('fetch() not supported in preview'); }

  // --- Internal ---------------------------------------------------------

  private synthStat(): FsObjectStat {
    return {
      modifiedAt: Date.now(),
      modifiedBy: this.userId,
      modifiedByName: null,
      modifiedInChannel: this.channelId,
      modifiedInConversation: this.conversationId,
      modifiedInInteraction: null,
    };
  }
}

class FsConversationHandle {
  constructor(private parent: FsChannel, private convId: string) {}

  getInteractions(): Interaction[] { return this.parent.getInteractionsScoped(this.convId); }
  getTree(): Record<string, Interaction> { return this.parent.getTreeScoped(this.convId); }
  get activeLeafId(): string | undefined { return this.parent.getActiveLeafScoped(this.convId); }
  setActiveLeaf(id: string): void { this.parent.setActiveLeafScoped(id, this.convId); }
  getSystemInstruction(): string | undefined { return this.parent.getSystemInstructionScoped(this.convId); }
  async setSystemInstruction(i: string | null): Promise<void> { return this.parent.setSystemInstructionScoped(i, this.convId); }
  async rename(name: string): Promise<void> { return this.parent.renameConversationScoped(name, this.convId); }
  async findObjects(o: FindObjectsOptions) { return this.parent.findObjects(o); }
  async createObject(o: CreateObjectOptions) { return this.parent.createObjectScoped(o, this.convId); }
  async updateObject(id: string, o: UpdateObjectOptions) { return this.parent.updateObjectScoped(id, o, this.convId); }
  async deleteObjects(ids: string[]): Promise<void> { return this.parent.deleteObjects(ids); }
  async createCollection(name: string, fields: FieldDef[]) { return this.parent.createCollection(name, fields); }
  async alterCollection(name: string, fields: FieldDef[]) { return this.parent.alterCollection(name, fields); }
  async dropCollection(name: string): Promise<void> { return this.parent.dropCollection(name); }
  setMetadata(k: string, v: unknown): void { void this.parent.setMetadataScoped(k, v, this.convId); }
  async prompt(): Promise<never> { throw new Error('prompt() not supported in preview'); }
}
