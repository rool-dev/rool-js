import { EventEmitter } from './event-emitter.js';
import type { GraphQLClient, OpenSpaceResult } from './graphql.js';
import type { RestClient } from './rest.js';
import { SpaceSubscriptionManager } from './subscription.js';
import { ConversationHandle, generateEntityId } from './space-session.js';
import { RoolWebDAV, WebDAVError, type SpaceFileStorageUsage } from './webdav.js';
import { isObjectPath, machinePath, machineUri } from './path.js';
import type { AuthManager } from './auth.js';
import type { Logger } from './logger.js';
import type { SpaceRouter, RouteInfo } from './router.js';
import type { RoolClientInfo } from './client-info.js';
import type {
  RoolObject,
  GetObjectsResult,
  RoolSpaceEvents,
  RoolUserRole,
  PromptOptions,
  UpdateObjectOptions,
  MoveObjectOptions,
  Conversation,
  ConversationVisibility,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  CollectionOptions,
  InviteRole,
  SpaceInvite,
  SpaceInviteCreated,
  SpaceMember,
  SpaceEvent,
  ConnectionState,
} from './types.js';

const GET_OBJECTS_CHUNK_SIZE = 500;

function objectPath(input: string): string {
  const path = machinePath(input);
  if (!isObjectPath(path)) {
    throw new Error(`Object path must be /space/<collection>/<name>.json without dotfiles: ${input}`);
  }
  return path;
}

function collectionPath(name: string): string {
  return machinePath(`/space/${name}`);
}

function schemaPath(name: string): string {
  return `${collectionPath(name)}/.schema.json`;
}

function objectFromBody(path: string, body: Record<string, unknown>): RoolObject {
  return { path, body };
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function patchBody(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

function collectionDef(input: FieldDef[] | CollectionDef, options?: CollectionOptions): CollectionDef {
  const base: CollectionDef = Array.isArray(input)
    ? { fields: input }
    : { fields: input.fields, schemaOrgType: input.schemaOrgType };
  const schemaOrgType = options?.schemaOrgType ?? base.schemaOrgType;
  return schemaOrgType ? { fields: base.fields, schemaOrgType } : { fields: base.fields };
}


interface AttachmentUpload {
  filename: string;
  contentType: string;
  body: BodyInit;
}

function attachmentBody(
  file: File | Blob | { data: string; contentType: string; filename?: string }
): AttachmentUpload {
  if (isFile(file)) {
    return {
      filename: safeAttachmentFilename(file.name, file.type),
      contentType: file.type || 'application/octet-stream',
      body: file,
    };
  }

  if (isBlob(file)) {
    const contentType = file.type || 'application/octet-stream';
    return {
      filename: safeAttachmentFilename('attachment', contentType),
      contentType,
      body: file,
    };
  }

  return {
    filename: safeAttachmentFilename(file.filename ?? 'attachment', file.contentType),
    contentType: file.contentType,
    body: base64Body(file.data),
  };
}

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function safeAttachmentFilename(name: string, contentType: string): string {
  const fallback = `attachment.${extensionForContentType(contentType)}`;
  const leaf = name.split(/[/\\]/).pop() || fallback;
  const cleaned = leaf.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, '_');
  return cleaned.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '') || fallback;
}

function extensionForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'text/markdown') return 'md';
  if (contentType === 'text/plain') return 'txt';
  if (contentType === 'text/csv') return 'csv';
  if (contentType === 'text/html') return 'html';
  if (contentType === 'application/json') return 'json';
  if (contentType === 'application/xml') return 'xml';
  return 'bin';
}

function base64Body(data: string): ArrayBuffer {
  const clean = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  if (typeof Buffer !== 'undefined') {
    const buffer = Buffer.from(clean, 'base64');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}


export interface SpaceConfig {
  id: string;
  openSpaceResult: OpenSpaceResult;
  graphqlClient: GraphQLClient;
  restClient: RestClient;
  authManager: AuthManager;
  router: SpaceRouter;
  initialRoute: RouteInfo;
  logger: Logger;
  clientInfo: RoolClientInfo;
  onClose: () => void;
}

/** An imperative API handle for one open space. */
export class RoolSpace extends EventEmitter<RoolSpaceEvents> {
  private _id: string;
  private _openSpaceResult: OpenSpaceResult;
  private _connectionState: ConnectionState = 'reconnecting';
  private _closed = false;
  private _graphqlClient: GraphQLClient;
  private _restClient: RestClient;
  private _webdav: RoolWebDAV;
  private _logger: Logger;
  private authManager: AuthManager;
  private router: SpaceRouter;
  private _route: RouteInfo;
  private onCloseCallback: () => void;
  private clientInfo: RoolClientInfo;
  private subscriptionManager: SpaceSubscriptionManager | null = null;

  constructor(config: SpaceConfig) {
    super();
    this._id = config.id;
    this._openSpaceResult = config.openSpaceResult;
    this._graphqlClient = config.graphqlClient;
    this._restClient = config.restClient;
    this._logger = config.logger;
    this._emitterLogger = config.logger;
    this.authManager = config.authManager;
    this.router = config.router;
    this._route = config.initialRoute;
    this.onCloseCallback = config.onClose;
    this.clientInfo = config.clientInfo;
    this._webdav = new RoolWebDAV({
      webdavUrl: config.initialRoute.server,
      spaceId: config.id,
      authManager: config.authManager,
      clientInfo: config.clientInfo,
      onRefused: async () => {
        await this.reroute();
        return this._route.server;
      },
    });

    this._graphqlClient.setOnRefused(() => this.reroute());
    this._restClient.setOnRefused(async () => {
      await this.reroute();
      return this._route.server;
    });
    this.startSubscription();
  }

  get id(): string { return this._id; }
  get name(): string { return this._openSpaceResult.name; }
  get role(): RoolUserRole { return this._openSpaceResult.role; }
  get isReadOnly(): boolean { return this.role === 'viewer'; }
  get memberCount(): number { return this._openSpaceResult.memberCount; }
  get openSpaceResult(): OpenSpaceResult { return this._openSpaceResult; }
  get connectionState(): ConnectionState { return this._connectionState; }
  get route(): RouteInfo { return this._route; }
  get webdav(): RoolWebDAV { return this._webdav; }

  async refresh(): Promise<OpenSpaceResult> {
    this._openSpaceResult = await this._graphqlClient.openSpace(this._id);
    return this._openSpaceResult;
  }

  async listConversations() {
    return (await this.refresh()).conversationMeta;
  }

  conversation(conversationId: string): ConversationHandle {
    if (!conversationId || conversationId.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
      throw new Error('conversationId must be 1–32 characters containing only alphanumeric characters, hyphens, and underscores');
    }
    return new ConversationHandle(this, conversationId);
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    return this._graphqlClient.getConversation(this._id, conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this._graphqlClient.deleteConversation(this._id, conversationId);
  }

  async createConversation(agent: string, visibility: ConversationVisibility): Promise<string> {
    return this._graphqlClient.createConversation(this._id, agent, visibility);
  }

  async listAgents(): Promise<string[]> {
    return this._graphqlClient.listAgents(this._id);
  }

  async deleteAgent(agent: string): Promise<void> {
    await this._graphqlClient.deleteAgent(this._id, agent);
  }

  async canUndo(): Promise<boolean> {
    return (await this._graphqlClient.checkpointStatus(this._id)).canUndo;
  }

  async canRedo(): Promise<boolean> {
    return (await this._graphqlClient.checkpointStatus(this._id)).canRedo;
  }

  async undo(): Promise<boolean> {
    return (await this._graphqlClient.undo(this._id)).success;
  }

  async redo(): Promise<boolean> {
    return (await this._graphqlClient.redo(this._id)).success;
  }

  private davHeaders(interactionId?: string): Headers {
    const headers = new Headers();
    if (interactionId) headers.set('X-Rool-Interaction-Id', interactionId);
    return headers;
  }

  private async readObject(path: string): Promise<{ object: RoolObject; etag: string | null } | undefined> {
    const canonical = objectPath(path);
    try {
      const response = await this._webdav.get(canonical);
      const body = jsonObject(await response.json(), `Object ${canonical}`);
      return { object: objectFromBody(canonical, body), etag: response.headers.get('ETag') };
    } catch (error) {
      if (error instanceof WebDAVError && error.status === 404) return undefined;
      if (error instanceof SyntaxError) throw new Error(`Object ${canonical} did not contain valid JSON`);
      throw error;
    }
  }

  /** Get an object JSON file by machine path. Fetches from the server on each call. */
  async getObject(path: string): Promise<RoolObject | undefined> {
    return (await this.readObject(path))?.object;
  }

  /** Get object JSON files by machine path in bulk. Duplicate paths are fetched once. */
  async getObjects(paths: string[]): Promise<GetObjectsResult> {
    const canonical: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      const normalized = objectPath(path);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      canonical.push(normalized);
    }

    const result: GetObjectsResult = { objects: [], missing: [] };
    for (let i = 0; i < canonical.length; i += GET_OBJECTS_CHUNK_SIZE) {
      const chunk = canonical.slice(i, i + GET_OBJECTS_CHUNK_SIZE);
      const partial = await this._restClient.getObjects(this._id, chunk);
      result.objects.push(...partial.objects);
      result.missing.push(...partial.missing);
    }
    return result;
  }

  /** Create or replace an object JSON file. */
  async putObject(path: string, body: Record<string, unknown>): Promise<{ object: RoolObject; message: string }> {
    const canonical = objectPath(path);
    const optimistic = objectFromBody(canonical, body);

    try {
      const interactionId = generateEntityId();
      await this._webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        headers: this.davHeaders(interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Put ${canonical}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to put object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** Patch an existing object JSON file. */
  async patchObject(path: string, options: UpdateObjectOptions): Promise<{ object: RoolObject; message: string }> {
    const canonical = objectPath(path);
    const data = options.data ?? {};
    const current = await this.readObject(canonical);
    if (!current) throw new Error(`Object ${canonical} not found`);
    const body = patchBody(current.object.body, data);
    const optimistic = objectFromBody(canonical, body);

    try {
      const interactionId = generateEntityId();
      await this._webdav.put(canonical, JSON.stringify(body), {
        contentType: 'application/json',
        ifMatch: current.etag ?? undefined,
        headers: this.davHeaders(interactionId),
      });
      const fresh = await this.getObject(canonical) ?? optimistic;
      return { object: fresh, message: `Patched ${canonical}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to patch object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** Move (rename/relocate) an object. */
  async moveObject(from: string, to: string, options?: MoveObjectOptions): Promise<{ object: RoolObject; message: string }> {
    const fromPath = objectPath(from);
    const toPath = objectPath(to);
    const optimistic = objectFromBody(toPath, options?.body ?? {});

    try {
      const interactionId = generateEntityId();
      await this._webdav.move(fromPath, toPath, {
        headers: this.davHeaders(interactionId),
      });
      if (options?.body) {
        await this._webdav.put(toPath, JSON.stringify(options.body), {
          contentType: 'application/json',
          headers: this.davHeaders(interactionId),
        });
      }
      const fresh = await this.getObject(toPath) ?? optimistic;
      return { object: fresh, message: `Moved ${fromPath} to ${toPath}` };
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to move object:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /** Delete object JSON files by path. */
  async deleteObjects(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const canonical = paths.map(objectPath);

    try {
      const interactionId = generateEntityId();
      for (const path of canonical) {
        await this._webdav.delete(path, {
          headers: this.davHeaders(interactionId),
        });
      }
    } catch (error) {
      this._logger.error('[RoolSpace] Failed to delete paths:', error);
      this.emit('syncError', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Read space metadata from `/space/.meta.json`. Returns `{}` when the space has
   * no metadata file yet. Stateless — callers (e.g. a reactive wrapper) cache and
   * re-fetch this on their own schedule, typically when a file-tree sync reports
   * the node changed.
   */
  async readMeta(): Promise<Record<string, unknown>> {
    try {
      const response = await this._webdav.get('/space/.meta.json');
      return jsonObject(await response.json(), 'space meta');
    } catch (error) {
      if (error instanceof WebDAVError && error.status === 404) return {};
      throw error;
    }
  }

  /**
   * Write the full metadata blob to `/space/.meta.json`, attributed to a
   * conversation. Callers compose the blob (e.g. read-merge-write) — this does no
   * merging.
   */
  async writeMeta(meta: Record<string, unknown>): Promise<void> {
    await this._webdav.put('/space/.meta.json', JSON.stringify(meta), {
      contentType: 'application/json',
      headers: this.davHeaders(generateEntityId()),
    });
  }

  /**
   * Read the collection schema: one `/space/<name>/.schema.json` per collection
   * directory under `/space`. Returns `{}` for a space with no collections.
   * Stateless — reactive callers re-fetch when a `.schema.json` node changes.
   */
  async readSchema(): Promise<SpaceSchema> {
    const listing = await this._webdav.propfind('/space', { depth: '1', props: ['resourcetype'] });
    const collections = listing.responses
      .filter((r) => r.isCollection && r.path !== '/space')
      .map((r) => r.path.split('/').pop() as string);
    const entries = await Promise.all(collections.map(async (name) => {
      try {
        const response = await this._webdav.get(`/space/${name}/.schema.json`);
        return [name, jsonObject(await response.json(), `schema ${name}`)] as const;
      } catch (error) {
        if (error instanceof WebDAVError && error.status === 404) return null;
        throw error;
      }
    }));
    const schema: SpaceSchema = {};
    for (const entry of entries) if (entry) schema[entry[0]] = entry[1] as unknown as CollectionDef;
    return schema;
  }


  /** Create a new collection (MKCOL + schema JSON). */
  async createCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    const def = collectionDef(fields, options);
    await this._webdav.mkcol(collectionPath(name), { headers: this.davHeaders(generateEntityId()) });
    await this._webdav.put(schemaPath(name), JSON.stringify(def), {
      contentType: 'application/json',
      headers: this.davHeaders(generateEntityId()),
    });
    return def;
  }


  /** Alter an existing collection's schema JSON. */
  async alterCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef> {
    const def = collectionDef(fields, options);
    await this._webdav.put(schemaPath(name), JSON.stringify(def), {
      contentType: 'application/json',
      headers: this.davHeaders(generateEntityId()),
    });
    return def;
  }


  /** Drop a collection (DELETE). */
  async dropCollection(name: string): Promise<void> {
    await this._webdav.delete(collectionPath(name), { collection: true, headers: this.davHeaders(generateEntityId()) });
  }



  /** @internal */
  async _updateConversation(
    conversationId: string,
    options: { name?: string; systemInstruction?: string | null },
  ): Promise<void> {
    await this._graphqlClient.updateConversation(this._id, conversationId, options);
  }

  /** @internal */
  async _prompt(prompt: string, conversationId: string, options: PromptOptions | undefined): Promise<{ message: string; objects: RoolObject[]; creditsUsed: number }> {
    const { attachments, signal, interactionId = generateEntityId(), parentInteractionId = null, ...rest } = options ?? {};

    let attachmentRefs: string[] | undefined;
    if (attachments?.length) {
      attachmentRefs = await Promise.all(
        attachments.map(async (attachment) => {
          const path = typeof attachment === 'string' ? machinePath(attachment) : await this.uploadAttachment(attachment, conversationId);
          return machineUri(path);
        })
      );
    }

    let onAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        this.stopConversation(conversationId).catch(() => { });
      } else {
        onAbort = () => {
          this.stopConversation(conversationId).catch(() => { });
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let result;
    try {
      result = await this._graphqlClient.prompt(this._id, prompt, conversationId, {
        ...rest,
        attachmentRefs,
        interactionId,
        parentInteractionId,
      });
    } finally {
      if (onAbort) signal!.removeEventListener('abort', onAbort);
    }

    const objects: RoolObject[] = [];
    const fetched = await Promise.all(result.modifiedObjectPaths.map((path) => this.getObject(path)));
    for (const object of fetched) {
      if (object) objects.push(object);
    }

    return {
      message: result.message,
      objects,
      creditsUsed: result.creditsUsed,
    };
  }


  /**
   * Stop whatever is running in a conversation. A conversation processes one
   * run at a time, so no interaction handle is needed.
   *
   * Returns whether anything was actually running.
   */
  async stopConversation(conversationId: string): Promise<boolean> {
    return this._graphqlClient.stopConversation(this._id, conversationId);
  }

  /**
   * Fetch an external URL via the server proxy, bypassing CORS restrictions.
   */
  async fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown }
  ): Promise<Response> {
    return this._restClient.proxyFetch(this._id, url, init);
  }

  private async uploadAttachment(
    file: File | Blob | { data: string; contentType: string; filename?: string },
    conversationId: string
  ): Promise<string> {
    const attachment = attachmentBody(file);
    const path = `/rool-drive/attachments/${conversationId}/${attachment.filename}`;
    // createParents avoids racing MKCOLs when multiple attachments upload concurrently.
    await this._webdav.put(path, attachment.body, {
      contentType: attachment.contentType,
      createParents: true,
    });
    return path;
  }


  async getStorageUsage(): Promise<SpaceFileStorageUsage> {
    return this._webdav.getStorageUsage();
  }

  async fetchPath(path: string, options?: {
    range?: string | { start: number; end?: number };
    signal?: AbortSignal;
  }): Promise<Response> {
    const canonical = machinePath(path);
    if (!canonical.startsWith('/rool-drive/')) throw new Error('Path is not a fetchable file');
    return this._webdav.get(canonical, options);
  }

  async rename(newName: string): Promise<void> {
    await this._graphqlClient.renameSpace(this._id, newName);
    this._openSpaceResult = { ...this._openSpaceResult, name: newName };
  }

  async delete(): Promise<void> {
    await this._graphqlClient.deleteSpace(this._id);
  }

  async listUsers(): Promise<SpaceMember[]> {
    return this._graphqlClient.listSpaceUsers(this._id);
  }

  async setUserRole(userId: string, role: InviteRole): Promise<void> {
    await this._graphqlClient.setSpaceUserRole(this._id, userId, role);
  }

  async removeUser(userId: string): Promise<void> {
    await this._graphqlClient.removeSpaceUser(this._id, userId);
  }

  async createInvite(
    role: InviteRole,
    options?: { email?: string; expiresInDays?: number; maxUses?: number },
  ): Promise<SpaceInviteCreated> {
    return this._graphqlClient.createSpaceInvite(this._id, role, options);
  }

  async listInvites(): Promise<SpaceInvite[]> {
    return this._graphqlClient.listSpaceInvites(this._id);
  }

  async revokeInvite(inviteId: string): Promise<boolean> {
    return this._graphqlClient.revokeSpaceInvite(this._id, inviteId);
  }

  async exportArchive(): Promise<Blob> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      'X-Rool-Token': tokens.roolToken,
    };
    const path = `/spaces/${encodeURIComponent(this._id)}/export`;
    const buildUrl = () => `${this._route.server.replace(/\/+$/, '')}${path}`;

    let response = await fetch(buildUrl(), { method: 'GET', headers });
    if (response.status === 421) {
      await this.reroute();
      response = await fetch(buildUrl(), { method: 'GET', headers });
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to export space: ${response.status} ${errorText}`);
    }
    return response.blob();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.subscriptionManager?.destroy();
    this.subscriptionManager = null;
    this.removeAllListeners();
    this.onCloseCallback();
  }

  private startSubscription(): void {
    let firstProbe = true;
    this.subscriptionManager = new SpaceSubscriptionManager({
      getGraphqlUrl: async () => {
        if (firstProbe) {
          firstProbe = false;
          return this._graphqlClient.graphqlUrl;
        }
        return this.reroute();
      },
      authManager: this.authManager,
      logger: this._logger,
      clientInfo: this.clientInfo,
      spaceId: this._id,
      onEvent: (event) => this.handleSpaceEvent(event),
      onConnectionStateChanged: (state: ConnectionState) => {
        this._connectionState = state;
        this.emit('connectionStateChanged', state);
      },
      onError: (error) => this._logger.error(`[RoolSpace] Space ${this._id} subscription error:`, error),
    });
    void this.subscriptionManager.subscribe().catch((error) => {
      if (!this._closed) this._logger.error(`[RoolSpace] Space ${this._id} subscription failed:`, error);
    });
  }

  private async reroute(): Promise<string> {
    const route = await this.router.resolve(this._id);
    this._route = route;
    this._webdav.setWebDAVUrl(route.server);
    this._restClient.setApiUrl(route.server);
    const url = `${route.server.replace(/\/+$/, '')}/graphql`;
    this._graphqlClient.setGraphqlUrl(url);
    return url;
  }

  private handleSpaceEvent(event: SpaceEvent): void {
    if (this._closed || event.type === 'connected') return;

    if (event.type === 'space_files_changed') {
      this.emit('filesChanged', { spaceId: event.spaceId, source: event.source, timestamp: event.timestamp });
      return;
    }
    if (event.type === 'space_files_reset') {
      this.emit('filesReset', { spaceId: event.spaceId, source: event.source, timestamp: event.timestamp });
      return;
    }
    if (event.type !== 'conversation_updated' || !event.conversationId) return;

    this.emit('conversationUpdated', {
      conversationId: event.conversationId,
      conversation: event.conversation ?? null,
      source: event.source === 'agent' ? 'remote_agent' : 'remote_user',
      timestamp: event.timestamp,
    });
  }
}
