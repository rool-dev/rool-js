import {
  machineSearch,
  type MachineSearchOptions,
  type MachineSearchPage,
} from "./search.js";
import { createMachineAgents, type MachineAgents } from "./agents.js";
import type { RoolClientEvent } from "./events.js";
import { WatchedList } from "./watched-list.js";
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
  CreateWebdavCredential,
  CreatedWebdavCredential,
  WebdavCredential,
  CreateMachineInvite,
  CreateMcpConnection,
  CreatedMachineInvite,
  MachineCheckpoint,
  MachineCreation,
  MachineCheckpointRestore,
  MachineFetchInit,
  MachineInvite,
  MachineMember,
  MachineMemberRoleConfiguration,
  MachineMeta,
  MachineSettings,
  MachineResources,
  MachineStorage,
  MachineSummary,
  McpAuthorization,
  McpConnection,
  McpConnectionAuthentication,
  ModelCatalog,
  PendingMachineMember,
} from "./types.js";
import { readExecStream, type MachineExecEvent } from "./exec.js";

export interface MachineSettingsApi {
  get(): Promise<MachineSettings>;
  replace(settings: MachineSettings): Promise<MachineSettings>;
}

export interface MachineExecOptions {
  /** Bash command, run in a fresh shell with the member's home as its initial directory. */
  command: string;
  /** UTF-8 text passed to standard input. */
  stdin?: string;
  /** Server execution timeout; defaults to 30,000 ms, clamped to 1,000–350,000 ms. */
  timeoutMs?: number;
  /** Superadmins only: execute as another member of this machine. */
  asUserId?: string;
  /** Abort the request. A command given no `stdin` is then ended in the machine; one with `stdin` runs to its timeout. */
  signal?: AbortSignal;
}

export interface MachineExecResult {
  /** Nonzero command exit codes are returned, not thrown. */
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
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
  /** Every restorable checkpoint, oldest first. */
  list(): Promise<MachineCheckpoint[]>;
  /** Restore the whole machine to a checkpoint. Nothing is discarded: the restored state is added as the newest checkpoint. */
  restore(checkpointId: string): Promise<MachineCheckpointRestore>;
}

export interface MachineMembersApi {
  list(): Promise<MachineMember[]>;
  /** Takers of the paying team's open invites that put them here; admins only. */
  pending(): Promise<PendingMachineMember[]>;
  getRole(userId: string): Promise<MachineMemberRoleConfiguration>;
  replaceRole(
    userId: string,
    configuration: MachineMemberRoleConfiguration,
  ): Promise<MachineMemberRoleConfiguration>;
  remove(userId: string): Promise<void>;
}

export interface MachineWebdavCredentialsView {
  readonly credentials: readonly WebdavCredential[];
  readonly loading: boolean;
  readonly error: unknown;
}

export type MachineWebdavCredentialsListener = (view: MachineWebdavCredentialsView) => void;

export interface MachineWebdavCredentialsApi {
  list(): Promise<WebdavCredential[]>;
  watch(listener: MachineWebdavCredentialsListener): () => void;
  create(credential: CreateWebdavCredential): Promise<CreatedWebdavCredential>;
  revoke(credentialId: string): Promise<void>;
}

export interface MachineInvitesApi {
  list(): Promise<MachineInvite[]>;
  create(invite: CreateMachineInvite): Promise<CreatedMachineInvite>;
  revoke(inviteId: string): Promise<void>;
}

export interface MachineMcpProvidersApi {
  /** Starts consent. Connections are created only after authorization completes. */
  startAuthorization(providerId: string): Promise<McpAuthorization>;
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
  readonly webdavCredentials: MachineWebdavCredentialsApi;
  readonly mcpProviders: MachineMcpProvidersApi;
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
    this.webdavCredentials = new MachineWebdavCredentialsClient(this.id, this.path, transport);
    this.mcpProviders = new MachineMcpProvidersClient(this.path, transport);
    this.mcpConnections = new MachineMcpConnectionsClient(
      this.id,
      this.path,
      transport,
    );
  }

  search(options: MachineSearchOptions): Promise<MachineSearchPage> {
    return machineSearch(
      this.transport.requestJson.bind(this.transport),
      this.path,
      options,
    );
  }

  /** The models a prompt here may use; refetch on `providers_changed`. */
  getModels(options: { signal?: AbortSignal } = {}): Promise<ModelCatalog> {
    return this.transport.requestJson(`${this.path}/models`, {
      signal: options.signal,
    });
  }

  /** Disk usage against the plan, split by what uses it. A first call on a large machine can take a while. */
  getStorage(options: { signal?: AbortSignal } = {}): Promise<MachineStorage> {
    return this.transport.requestJson(`${this.path}/storage`, {
      signal: options.signal,
    });
  }

  /** CPU and memory as the machine sees them. Reading never starts a stopped machine. */
  getResources(
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineResources> {
    return this.transport.requestJson(`${this.path}/resources`, {
      signal: options.signal,
    });
  }

  /** Shut the machine down after saving its state. The next request that needs it starts it again. */
  async stop(): Promise<void> {
    await this.transport.request(`${this.path}/stop`, { method: "POST" });
  }

  /** Run a command as the authenticated member (owner/admin) and collect its output as text. */
  async exec(options: MachineExecOptions): Promise<MachineExecResult> {
    const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
    const output = { stdout: "", stderr: "" };
    for await (const event of this.execStream(options)) {
      if (event.type === "exit") {
        return {
          exitCode: event.exitCode,
          stdout: output.stdout + decoders.stdout.decode(),
          stderr: output.stderr + decoders.stderr.decode(),
          durationMs: event.durationMs,
        };
      }
      output[event.type] += decoders[event.type].decode(event.data, {
        stream: true,
      });
    }
    throw new Error("The command's output ended before its exit");
  }

  /** Run a command and receive its output as it is produced, as bytes; the last event is its exit. */
  async *execStream(
    options: MachineExecOptions,
  ): AsyncGenerator<MachineExecEvent> {
    const { command, stdin, timeoutMs, asUserId, signal } = options;
    const response = await this.transport.request(`${this.path}/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.rool.exec-stream",
      },
      body: JSON.stringify({ command, stdin, timeoutMs, asUserId }),
      signal,
    });
    yield* readExecStream(response);
  }

  get(): Promise<MachineSummary> {
    return this.transport.requestJson(this.path);
  }

  async delete(): Promise<void> {
    await this.transport.request(this.path, { method: "DELETE" });
    this.files.unwatch();
    this.transport.deleted();
  }

  duplicate(settings: MachineCreation): Promise<MachineSummary> {
    return this.transport.requestJson(`${this.path}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }

  /** Change a team machine's type, as an admin of the machine or of its team.
   *  It boots with the new type next time; a running machine is stopped. */
  setType(type: string): Promise<MachineSummary> {
    return this.transport.requestJson(`${this.path}/type`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  }

  /** Move the machine to another account, as an admin of both. */
  async move(accountId: string): Promise<void> {
    await this.transport.request(`${this.path}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
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

  async list(): Promise<MachineCheckpoint[]> {
    const { checkpoints } = await this.transport.requestJson<{
      checkpoints: MachineCheckpoint[];
    }>(`${this.machinePath}/checkpoints`);
    return checkpoints;
  }

  restore(checkpointId: string): Promise<MachineCheckpointRestore> {
    return this.transport.requestJson(
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

  async pending(): Promise<PendingMachineMember[]> {
    const { pending } = await this.transport.requestJson<{
      pending: PendingMachineMember[];
    }>(`${this.machinePath}/pending-members`);
    return pending;
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

class MachineMcpProvidersClient implements MachineMcpProvidersApi {
  constructor(
    private readonly machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {}

  startAuthorization(providerId: string): Promise<McpAuthorization> {
    return this.transport.requestJson(
      `${this.machinePath}/mcp-providers/${encodeURIComponent(providerId)}/authorization`,
      { method: "POST" },
    );
  }
}

class MachineMcpConnectionsClient implements MachineMcpConnectionsApi {
  private readonly path: string;
  private readonly watched: WatchedList<McpConnection>;

  constructor(
    machineId: string,
    machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {
    this.path = `${machinePath}/mcp-connections`;
    this.watched = new WatchedList(
      (signal) => this.load(signal),
      (listener) => transport.subscribeEvents(listener),
      (event) => event.type === "mcp_connections_changed" && event.machineId === machineId,
    );
  }

  list(): Promise<McpConnection[]> {
    return this.load();
  }

  watch(listener: MachineMcpConnectionsListener): () => void {
    return this.watched.watch(({ items, loading, error }) => listener({ connections: items, loading, error }));
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

  private connectionPath(connectionId: string): string {
    return `${this.path}/${encodeURIComponent(connectionId)}`;
  }
}

class MachineWebdavCredentialsClient implements MachineWebdavCredentialsApi {
  private readonly watched: WatchedList<WebdavCredential>;

  constructor(
    machineId: string,
    private readonly machinePath: string,
    private readonly transport: RoolMachineTransport,
  ) {
    this.watched = new WatchedList(
      (signal) => this.load(signal),
      (listener) => transport.subscribeEvents(listener),
      (event) => (event.type === "webdav_credentials_changed" || event.type === "machine_members_changed" || event.type === "machines_changed") && event.machineId === machineId,
    );
  }

  list(): Promise<WebdavCredential[]> {
    return this.load();
  }

  watch(listener: MachineWebdavCredentialsListener): () => void {
    return this.watched.watch(({ items, loading, error }) => listener({ credentials: items, loading, error }));
  }

  private async load(signal?: AbortSignal): Promise<WebdavCredential[]> {
    const { credentials } = await this.transport.requestJson<{ credentials: WebdavCredential[] }>(
      `${this.machinePath}/webdav-credentials`, { signal },
    );
    return credentials;
  }

  async create(credential: CreateWebdavCredential): Promise<CreatedWebdavCredential> {
    const generation = this.watched.generation;
    const created = await this.transport.requestJson<CreatedWebdavCredential>(`${this.machinePath}/webdav-credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    });
    // The caller alone receives the secret, never the watch cache or listeners.
    const { password, ...metadata } = created;
    this.watched.update(generation, (items) => [metadata, ...items.filter((item) => item.id !== metadata.id)]);
    return created;
  }

  async revoke(credentialId: string): Promise<void> {
    const generation = this.watched.generation;
    await this.transport.request(
      `${this.machinePath}/webdav-credentials/${encodeURIComponent(credentialId)}`,
      { method: "DELETE" },
    );
    this.watched.update(generation, (items) => items.filter((item) => item.id !== credentialId));
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
