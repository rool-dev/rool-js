import { createMachineAgents, type MachineAgents } from "./agents.js";
import type { RoolClientEvent } from "./events.js";
import {
  createMachineFiles,
  type MachineFiles,
  type MachineFileUploadProgress,
} from "./files.js";
import {
  createMachineStructuredApis,
  type MachineCollectionsApi,
  type MachineMetadataApi,
  type MachineObjectsApi,
} from "./structured.js";
import type {
  CreateMachineInvite,
  CreatedMachineInvite,
  MachineCheckpointCollection,
  MachineFetchInit,
  MachineInvite,
  MachineMember,
  MachineMemberRoleConfiguration,
  MachineSettings,
  MachineSummary,
} from "./types.js";

export interface MachineSettingsApi {
  get(): Promise<MachineSettings>;
  replace(settings: MachineSettings): Promise<MachineSettings>;
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

export interface RoolMachineTransport {
  send(
    path: string,
    init?: RequestInit,
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
    this.metadata = structured.metadata;
    this.collections = structured.collections;
    this.objects = structured.objects;
    this.settings = new MachineSettingsClient(this.path, transport);
    this.checkpoints = new MachineCheckpointsClient(this.path, transport);
    this.members = new MachineMembersClient(this.path, transport);
    this.invites = new MachineInvitesClient(this.path, transport);
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
