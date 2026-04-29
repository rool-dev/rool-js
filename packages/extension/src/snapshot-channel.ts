/**
 * SnapshotChannel — a BridgeableChannel backed by an in-memory snapshot.
 *
 * Mirrors the surface of @rool-dev/sdk's RoolChannel that BridgeHost
 * dispatches to (see ALLOWED_METHODS in host.ts), but reads and writes
 * a parsed `RoolSpaceData` JSON object directly. State is scratch:
 * mutations live in memory and die with the page.
 *
 * Designed for the in-VM preview server, where every microVM boots with
 * `/space/snapshot.json` and there is no GraphQL backend reachable.
 *
 * Out of scope (throws): AI prompts, checkpoint/undo/redo, server fetch.
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

// Mirror of rool-server's RoolSpaceData. Kept inline to avoid pulling
// the server package; this is the shape of `/space/snapshot.json`.
interface RoolObjectEntry {
  data: Record<string, unknown>;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInChannel: string;
  modifiedInConversation: string | null;
  modifiedInInteraction: string | null;
}

export interface RoolSpaceData {
  objects: Record<string, RoolObjectEntry>;
  meta?: Record<string, unknown>;
  channels?: Record<string, Channel>;
  schema: SpaceSchema;
}

export interface SnapshotChannelOptions {
  /** Parsed snapshot.json (mutated in place). */
  data: RoolSpaceData;
  /** Space id (matches snapshot info.json). */
  spaceId: string;
  /** Space name (matches snapshot info.json). */
  spaceName: string;
  /** Channel id this view operates against. The matching channel record
   *  must exist in `data.channels[channelId]`, or one will be synthesized. */
  channelId: string;
  /** User id to attribute mutations to. Default: 'snapshot-user'. */
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

export class SnapshotChannel implements BridgeableChannel {
  readonly id: string;
  readonly name: string;
  readonly role: RoolUserRole;
  readonly linkAccess: LinkAccess;
  readonly userId: string;
  readonly channelId: string;

  private data: RoolSpaceData;
  private conversationId: string;
  private channel: Channel;
  private activeLeaves = new Map<string, string>();
  private emitter = new TinyEmitter();

  constructor(opts: SnapshotChannelOptions) {
    this.id = opts.spaceId;
    this.name = opts.spaceName;
    this.role = opts.role ?? 'editor';
    this.linkAccess = opts.linkAccess ?? 'none';
    this.userId = opts.userId ?? 'snapshot-user';
    this.channelId = opts.channelId;
    this.conversationId = opts.conversationId ?? DEFAULT_CONVERSATION_ID;
    this.data = opts.data;

    if (!this.data.channels) this.data.channels = {};
    let ch = this.data.channels[this.channelId];
    if (!ch) {
      ch = {
        createdAt: Date.now(),
        createdBy: this.userId,
        conversations: {},
      };
      this.data.channels[this.channelId] = ch;
    }
    this.channel = ch;
  }

  // --- BridgeableChannel surface ----------------------------------------

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.on(event, handler as Listener);
  }
  off(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler as Listener);
  }

  conversation(conversationId: string): unknown {
    return new SnapshotConversationHandle(this, conversationId);
  }

  // --- Object reads -----------------------------------------------------

  async getObject(objectId: string): Promise<RoolObject | undefined> {
    const entry = this.data.objects[objectId];
    return entry ? (entry.data as RoolObject) : undefined;
  }

  stat(objectId: string): RoolObjectStat | undefined {
    const entry = this.data.objects[objectId];
    if (!entry) return undefined;
    return {
      modifiedAt: entry.modifiedAt,
      modifiedBy: entry.modifiedBy,
      modifiedByName: entry.modifiedByName,
      modifiedInChannel: entry.modifiedInChannel,
      modifiedInConversation: entry.modifiedInConversation,
      modifiedInInteraction: entry.modifiedInInteraction,
    };
  }

  getObjectIds(options?: { limit?: number; order?: 'asc' | 'desc' }): string[] {
    const entries = Object.entries(this.data.objects);
    entries.sort((a, b) => b[1].modifiedAt - a[1].modifiedAt);
    let ids = entries.map(([id]) => id);
    if (options?.order === 'asc') ids = ids.reverse();
    if (options?.limit !== undefined) ids = ids.slice(0, options.limit);
    return ids;
  }

  async findObjects(options: FindObjectsOptions): Promise<{ objects: RoolObject[]; message: string }> {
    if (options.prompt) {
      throw new Error('findObjects with `prompt` (AI) is not supported by SnapshotChannel');
    }
    const candidateIds = options.objectIds ?? Object.keys(this.data.objects);
    const matches: { id: string; entry: RoolObjectEntry }[] = [];
    for (const id of candidateIds) {
      const entry = this.data.objects[id];
      if (!entry) continue;
      if (options.collection !== undefined && entry.data.type !== options.collection) continue;
      if (options.where) {
        let ok = true;
        for (const [k, v] of Object.entries(options.where)) {
          if (entry.data[k] !== v) { ok = false; break; }
        }
        if (!ok) continue;
      }
      matches.push({ id, entry });
    }
    matches.sort((a, b) => b.entry.modifiedAt - a.entry.modifiedAt);
    if (options.order === 'asc') matches.reverse();
    let limited = matches;
    if (options.limit !== undefined) limited = matches.slice(0, options.limit);
    return {
      objects: limited.map(m => m.entry.data as RoolObject),
      message: `Found ${limited.length} object(s)`,
    };
  }

  // --- Object writes ----------------------------------------------------

  async createObject(options: CreateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this.createObjectScoped(options, this.conversationId);
  }

  async createObjectScoped(options: CreateObjectOptions, conversationId: string): Promise<{ object: RoolObject; message: string }> {
    const { data } = options;
    const objectId = typeof data.id === 'string' && data.id ? data.id : generateEntityId();
    if (!/^[a-zA-Z0-9_-]+$/.test(objectId)) {
      throw new Error(`Invalid object ID "${objectId}"`);
    }
    if (this.data.objects[objectId]) {
      throw new Error(`Object "${objectId}" already exists`);
    }
    const dataWithId = { ...data, id: objectId } as RoolObject;
    const entry: RoolObjectEntry = {
      data: dataWithId,
      modifiedAt: Date.now(),
      modifiedBy: this.userId,
      modifiedByName: null,
      modifiedInChannel: this.channelId,
      modifiedInConversation: conversationId,
      modifiedInInteraction: null,
    };
    this.data.objects[objectId] = entry;
    this.emitter.emit('objectCreated', { objectId, object: dataWithId, source: 'local_user' });
    return { object: dataWithId, message: 'Object created' };
  }

  async updateObject(objectId: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    return this.updateObjectScoped(objectId, options, this.conversationId);
  }

  async updateObjectScoped(objectId: string, options: UpdateObjectOptions, conversationId: string): Promise<{ object: RoolObject; message: string }> {
    if (options.prompt) {
      throw new Error('updateObject with `prompt` (AI) is not supported by SnapshotChannel');
    }
    const entry = this.data.objects[objectId];
    if (!entry) throw new Error(`NOT_FOUND: Object "${objectId}" not found`);

    const data = options.data;
    if (data) {
      if (data.id !== undefined && data.id !== null && data.id !== objectId) {
        throw new Error('Cannot change id in updateObject');
      }
      const merged: Record<string, unknown> = { ...entry.data };
      for (const [k, v] of Object.entries(data)) {
        if (k === 'id' || k.startsWith('_')) continue;
        if (v === null || v === undefined) delete merged[k];
        else merged[k] = v;
      }
      entry.data = merged;
    }
    entry.modifiedAt = Date.now();
    entry.modifiedBy = this.userId;
    entry.modifiedInChannel = this.channelId;
    entry.modifiedInConversation = conversationId;
    entry.modifiedInInteraction = null;

    this.emitter.emit('objectUpdated', { objectId, object: entry.data as RoolObject, source: 'local_user' });
    return { object: entry.data as RoolObject, message: 'Object updated' };
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    for (const id of objectIds) {
      if (!this.data.objects[id]) throw new Error(`NOT_FOUND: Object "${id}" not found`);
    }
    for (const id of objectIds) {
      delete this.data.objects[id];
      this.emitter.emit('objectDeleted', { objectId: id, source: 'local_user' });
    }
  }

  // --- Schema -----------------------------------------------------------

  getSchema(): SpaceSchema {
    return this.data.schema;
  }

  async createCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    if (this.data.schema[name]) throw new Error(`Collection "${name}" already exists`);
    const def: CollectionDef = { fields: fields.map(f => ({ name: f.name, type: f.type })) };
    this.data.schema[name] = def;
    this.emitter.emit('schemaUpdated', { schema: this.data.schema, source: 'local_user' });
    return def;
  }

  async alterCollection(name: string, fields: FieldDef[]): Promise<CollectionDef> {
    if (!this.data.schema[name]) throw new Error(`Collection "${name}" not found`);
    const def: CollectionDef = { fields: fields.map(f => ({ name: f.name, type: f.type })) };
    this.data.schema[name] = def;
    this.emitter.emit('schemaUpdated', { schema: this.data.schema, source: 'local_user' });
    return def;
  }

  async dropCollection(name: string): Promise<void> {
    if (!this.data.schema[name]) throw new Error(`Collection "${name}" not found`);
    delete this.data.schema[name];
    this.emitter.emit('schemaUpdated', { schema: this.data.schema, source: 'local_user' });
  }

  // --- Conversation / interactions --------------------------------------

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
    // Default leaf: most recent interaction with no children
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
    this.setMetadataScoped(key, value, this.conversationId);
  }
  setMetadataScoped(key: string, value: unknown, _conversationId: string): void {
    if (!this.data.meta) this.data.meta = {};
    this.data.meta[key] = value;
    this.emitter.emit('metadataUpdated', { metadata: this.data.meta, source: 'local_user' });
  }

  getMetadata(key: string): unknown {
    return this.data.meta?.[key];
  }

  getAllMetadata(): Record<string, unknown> {
    return this.data.meta ?? {};
  }

  // --- Out of scope (no server) ----------------------------------------

  async prompt(): Promise<never> { throw new Error('prompt() not supported by SnapshotChannel'); }
  async checkpoint(): Promise<never> { throw new Error('checkpoint() not supported by SnapshotChannel'); }
  async canUndo(): Promise<boolean> { return false; }
  async canRedo(): Promise<boolean> { return false; }
  async undo(): Promise<boolean> { return false; }
  async redo(): Promise<boolean> { return false; }
  async clearHistory(): Promise<void> { /* no-op */ }
  async fetch(): Promise<never> { throw new Error('fetch() not supported by SnapshotChannel'); }
}

/**
 * Conversation handle delegating to a parent SnapshotChannel with an
 * explicit conversationId. Mirrors the methods BridgeHost dispatches
 * via channel.conversation(id).
 */
class SnapshotConversationHandle {
  constructor(private parent: SnapshotChannel, private convId: string) {}

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
  setMetadata(k: string, v: unknown): void { this.parent.setMetadataScoped(k, v, this.convId); }
  async prompt(): Promise<never> { throw new Error('prompt() not supported by SnapshotChannel'); }
}
