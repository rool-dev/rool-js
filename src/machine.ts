import { createMachineAgents, type MachineAgents } from "./agents.js";
import type { RoolClientEvent } from "./events.js";
import {
  createMachineFiles,
  type MachineFiles,
  type MachineFileRequestInit,
  type MachineFileUploadProgress,
} from "./files.js";
import {
  createMachineStructuredApis,
  type MachineCollectionsApi,
  type MachineObjectsApi,
  type MachineStructuredRequestOptions,
} from "./structured.js";
import type {
  CreateMachineInvite,
  CreateMcpConnection,
  CreatedMachineInvite,
  MachineCheckpointCollection,
  MachineFetchInit,
  MachineInvite,
  MachineMember,
  MachineMemberRoleConfiguration,
  MachineMeta,
  MachineSettings,
  MachineSummary,
  McpAuthorization,
  McpConnection,
  McpConnectionAuthentication,
} from "./types.js";

export interface MachineSettingsApi {
  get(): Promise<MachineSettings>;
  replace(settings: MachineSettings): Promise<MachineSettings>;
}

export type MachineMetadata = MachineMeta;

/** The machine's metadata document. `set` and `delete` are read-merge-replace
 *  conveniences; the last writer wins. */
export interface MachineMetadataApi {
  get(options?: MachineStructuredRequestOptions): Promise<MachineMetadata>;
  replace(
    metadata: MachineMetadata,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineMetadata>;
  set(
    key: string,
    value: unknown,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineMetadata>;
  delete(
    key: string,
    options?: MachineStructuredRequestOptions,
  ): Promise<MachineMetadata>;
}

export interface MachineCheckpointsApi {
  list(): Promise<MachineCheckpointCollection>;
  restore(checkpointId: string): Promise<void>;
}

export interface MachineMembersApi {
  list(): Promise<MachineMember[]>;
  getRole(userId: string): Promise<MachineMemberRoleConfiguration>;
  replaceRole(
    userId: string,
    configuration: MachineMemberRoleConfiguration,
  ): Promise<MachineMemberRoleConfiguration>;
  remove(userId: string): Promise<void>;
}

export interface MachineInvitesApi {
  list(): Promise<MachineInvite[]>;
  create(invite: CreateMachineInvite): Promise<CreatedMachineInvite>;
  revoke(inviteId: string): Promise<void>;
}

export interface MachineMcpConnectionsView {
  readonly connections: readonly McpConnection[];
  readonly loading: boolean;
  readonly error: unknown;
}

export type MachineMcpConnectionsListener = (
  view: MachineMcpConnectionsView,
) => void;

export interface MachineMcpConnectionsApi {
  list(): Promise<McpConnection[]>;
  watch(listener: MachineMcpConnectionsListener): () => void;
  get(connectionId: string): Promise<McpConnection>;
  create(connection: CreateMcpConnection): Promise<McpConnection>;
  remove(connectionId: string): Promise<void>;
  replaceAuthentication(
    connectionId: string,
    authentication: McpConnectionAuthentication,
  ): Promise<McpConnection>;
  startAuthorization(connectionId: string): Promise<McpAuthorization>;
  clearAuthorization(connectionId: string): Promise<McpConnection>;
}

export interface RoolMachineTransport {
  send(
    path: string,
    init?: MachineFileRequestInit,
    onUploadProgress?: (progress: MachineFileUploadProgress) => void,
  ): Promise<Response>;
  request(
    path: string,
    init?: RequestInit,
    allowHttpErrors?: boolean,
  ): Promise<Response>;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
  subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
  deleted(): void;
}

export class RoolMachine {
  readonly files: MachineFiles;
  readonly agents: MachineAgents;
  readonly metadata: MachineMetadataApi;
  readonly collections: MachineCollectionsApi;
  readonly objects: MachineObjectsApi;
  readonly settings: MachineSettingsApi;
  readonly checkpoints: MachineCheckpointsApi;
  readonly members: MachineMembersApi;
  readonly invites: MachineInvitesApi;
  readonly mcpConnections: MachineMcpConnectionsApi;

  private readonly path: string;

  constructor(
    readonly id: string,
    private readonly transport: RoolMachineTransport,
  ) {
    if (!id) throw new Error("machineId is required");

    this.path = `/v2/machines/${encodeURIComponent(id)}`;
    this.files = createMachineFiles(id, transport.send);
    this.agents = createMachineAgents(id, this.path, transport);
    const structured = createMachineStructuredApis(
      this.files,
      () => this.files.isWatching,
    );
    this.metadata = new MachineMetadataClient(this.path, transport);
    this.collections = structured.collections;
    this.objects = structured.objects;
    this.settings = new MachineSettingsClient(this.path, transport);
    this.checkpoints = new MachineCheckpointsClient(this.path, transport);
    this.members = new MachineMembersClient(this.path, transport);
    this.invites = new MachineInvitesClient(this.path, transport);
    this.mcpConnections = new MachineMcpConnectionsClient(
      this.id,
      this.path,
      transport,
    );
  }

  get(): Promise<MachineSummary> {
    return this.transport.requestJson(this.path);
  }

  async delete(): Promise<void> {
    await this.transport.request(this.path, { method: "DELETE" });
    this.files.unwatch();
    this.transport.deleted();
  }

  duplicate(settings: MachineSettings): Promise<MachineSummary> {
    return this.transport.requestJson(`${this.path}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }

  setHostname(hostname: string): Promise<MachineSummary> {
    return this.transport.requestJson(`${this.path}/hostname`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname }),
    });
  }

  fetchUrl(url: string, init: MachineFetchInit = {}): Promise<Response> {
    const { signal, ...upstreamInit } = init;
    return this.transport.request(
      `${this.path}/fetch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ...upstreamInit }),
        signal,
      },
      true,
    );
  }
}

class MachineSettingsClient implements MachineSettingsApi {
  constructor(
    private readonly machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {}

  get(): Promise<MachineSettings> {
    return this.transport.requestJson(`${this.machinePath}/settings`);
  }

  replace(settings: MachineSettings): Promise<MachineSettings> {
    return this.transport.requestJson(`${this.machinePath}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }
}

class MachineMetadataClient implements MachineMetadataApi {
  private readonly path: string;

  constructor(
    machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {
    this.path = `${machinePath}/meta`;
  }

  get(options: MachineStructuredRequestOptions = {}): Promise<MachineMetadata> {
    return this.transport.requestJson(this.path, { signal: options.signal });
  }

  replace(
    metadata: MachineMetadata,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineMetadata> {
    return this.transport.requestJson(this.path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
      signal: options.signal,
    });
  }

  async set(
    key: string,
    value: unknown,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineMetadata> {
    if (!key) throw new Error("Machine metadata key is required");
    const current = await this.get(options);
    if (
      Object.hasOwn(current, key) &&
      JSON.stringify(current[key]) === JSON.stringify(value)
    ) {
      return current;
    }
    return this.replace({ ...current, [key]: value }, options);
  }

  async delete(
    key: string,
    options: MachineStructuredRequestOptions = {},
  ): Promise<MachineMetadata> {
    if (!key) throw new Error("Machine metadata key is required");
    const current = await this.get(options);
    if (!Object.hasOwn(current, key)) return current;
    const { [key]: _removed, ...rest } = current;
    return this.replace(rest, options);
  }
}

class MachineCheckpointsClient implements MachineCheckpointsApi {
  constructor(
    private readonly machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {}

  list(): Promise<MachineCheckpointCollection> {
    return this.transport.requestJson(`${this.machinePath}/checkpoints`);
  }

  async restore(checkpointId: string): Promise<void> {
    await this.transport.request(
      `${this.machinePath}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
      { method: "POST" },
    );
  }
}

class MachineMembersClient implements MachineMembersApi {
  constructor(
    private readonly machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {}

  list(): Promise<MachineMember[]> {
    return this.transport.requestJson(`${this.machinePath}/members`);
  }

  getRole(userId: string): Promise<MachineMemberRoleConfiguration> {
    return this.transport.requestJson(this.rolePath(userId));
  }

  replaceRole(
    userId: string,
    configuration: MachineMemberRoleConfiguration,
  ): Promise<MachineMemberRoleConfiguration> {
    return this.transport.requestJson(this.rolePath(userId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuration),
    });
  }

  async remove(userId: string): Promise<void> {
    await this.transport.request(this.memberPath(userId), { method: "DELETE" });
  }

  private memberPath(userId: string): string {
    return `${this.machinePath}/members/${encodeURIComponent(userId)}`;
  }

  private rolePath(userId: string): string {
    return `${this.memberPath(userId)}/role`;
  }
}

const MCP_CONNECTION_WATCH_RETRY_MAX_MS = 5_000;

class MachineMcpConnectionsClient implements MachineMcpConnectionsApi {
  private readonly path: string;
  private readonly listeners = new Set<MachineMcpConnectionsListener>();
  private connections: McpConnection[] = [];
  private loading = true;
  private error: unknown = null;
  private watchController: AbortController | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private syncRequested = false;
  private syncLoop: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 250;

  constructor(
    private readonly machineId: string,
    machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {
    this.path = `${machinePath}/mcp-connections`;
  }

  list(): Promise<McpConnection[]> {
    return this.load();
  }

  watch(listener: MachineMcpConnectionsListener): () => void {
    this.listeners.add(listener);
    if (!this.watchController) this.startWatching();
    listener(this.view());

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopWatching();
    };
  }

  get(connectionId: string): Promise<McpConnection> {
    return this.transport.requestJson(this.connectionPath(connectionId));
  }

  create(connection: CreateMcpConnection): Promise<McpConnection> {
    return this.transport.requestJson(this.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connection),
    });
  }

  async remove(connectionId: string): Promise<void> {
    await this.transport.request(this.connectionPath(connectionId), {
      method: "DELETE",
    });
  }

  replaceAuthentication(
    connectionId: string,
    authentication: McpConnectionAuthentication,
  ): Promise<McpConnection> {
    return this.transport.requestJson(
      `${this.connectionPath(connectionId)}/authentication`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authentication),
      },
    );
  }

  startAuthorization(connectionId: string): Promise<McpAuthorization> {
    return this.transport.requestJson(
      `${this.connectionPath(connectionId)}/authorization`,
      { method: "POST" },
    );
  }

  clearAuthorization(connectionId: string): Promise<McpConnection> {
    return this.transport.requestJson(
      `${this.connectionPath(connectionId)}/authorization`,
      { method: "DELETE" },
    );
  }

  private async load(signal?: AbortSignal): Promise<McpConnection[]> {
    const result = await this.transport.requestJson<{
      connections: McpConnection[];
    }>(this.path, { signal });
    return result.connections;
  }

  private startWatching(): void {
    const controller = new AbortController();
    this.watchController = controller;
    this.loading = true;
    this.error = null;
    this.retryMs = 250;
    this.unsubscribeEvents = this.transport.subscribeEvents((event) => {
      const matchesMachine =
        event.type === "mcp_connections_changed" &&
        event.machineId === this.machineId;
      if (event.type === "session" || matchesMachine) this.requestSync();
    });
    this.requestSync();
  }

  private stopWatching(): void {
    this.watchController?.abort();
    this.watchController = null;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.syncRequested = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private requestSync(): void {
    const controller = this.watchController;
    if (!controller || controller.signal.aborted) return;
    this.syncRequested = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.syncLoop) return;

    // Events from one account report arrive together. Start on the next
    // microtask so they result in one fetch.
    const loop = Promise.resolve().then(() => this.runSyncLoop(controller));
    this.syncLoop = loop;
    const finished = () => {
      if (this.syncLoop === loop) this.syncLoop = null;
      const current = this.watchController;
      if (current && this.syncRequested && !current.signal.aborted) {
        this.requestSync();
      }
    };
    void loop.then(finished, finished);
  }

  private async runSyncLoop(controller: AbortController): Promise<void> {
    while (
      this.watchController === controller &&
      !controller.signal.aborted &&
      this.syncRequested
    ) {
      this.syncRequested = false;
      let connections: McpConnection[];
      try {
        connections = await this.load(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (this.syncRequested) continue;
        this.loading = false;
        this.error = error;
        this.scheduleRetry(controller);
        this.emit();
        return;
      }

      if (controller.signal.aborted) return;
      // An event arrived while the request was open, so its response may
      // already be stale. Fetch once more without publishing it.
      if (this.syncRequested) continue;
      this.connections = connections;
      this.loading = false;
      this.error = null;
      this.retryMs = 250;
      this.emit();
    }
  }

  private scheduleRetry(controller: AbortController): void {
    if (this.retryTimer || this.watchController !== controller) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(
      this.retryMs * 2,
      MCP_CONNECTION_WATCH_RETRY_MAX_MS,
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requestSync();
    }, delay);
  }

  private view(): MachineMcpConnectionsView {
    return {
      connections: [...this.connections],
      loading: this.loading,
      error: this.error,
    };
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }

  private connectionPath(connectionId: string): string {
    return `${this.path}/${encodeURIComponent(connectionId)}`;
  }
}

class MachineInvitesClient implements MachineInvitesApi {
  constructor(
    private readonly machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {}

  list(): Promise<MachineInvite[]> {
    return this.transport.requestJson(`${this.machinePath}/invites`);
  }

  create(invite: CreateMachineInvite): Promise<CreatedMachineInvite> {
    return this.transport.requestJson(`${this.machinePath}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite),
    });
  }

  async revoke(inviteId: string): Promise<void> {
    await this.transport.request(
      `${this.machinePath}/invites/${encodeURIComponent(inviteId)}`,
      { method: "DELETE" },
    );
  }
}
