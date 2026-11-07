import type { RoolClientEvent } from "./events.js";
import { WatchedValue } from "./watched-value.js";

export interface RoolAclView {
  readonly acl: RoolAcl | null;
  readonly loading: boolean;
  readonly error: unknown;
}

export interface RoolAclApi {
  get(): Promise<RoolAcl>;
  /** Shares the client's event feed. Stop watching when the signed-in user changes.
   * Unknown, invalidated and failed answers have acl: null, never inferred grants. */
  watch(listener: (view: RoolAclView) => void): () => void;
}

export class AclClient implements RoolAclApi {
  private readonly watched: WatchedValue<RoolAcl | null>;

  constructor(private readonly transport: {
    load(signal?: AbortSignal): Promise<RoolAcl>;
    subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
  }) {
    this.watched = new WatchedValue<RoolAcl | null>(
      signal => transport.load(signal),
      listener => transport.subscribeEvents(listener),
      event => event.type === "acl_changed",
      () => null,
      false,
    );
  }

  get(): Promise<RoolAcl> { return this.transport.load(); }

  watch(listener: (view: RoolAclView) => void): () => void {
    return this.watched.watch(({ value, loading, error }) => listener({ acl: value, loading, error }));
  }
}

/** Permissions to attempt an operation, not a promise that its constraints are met. */
export interface RoolAcl {
  version: 1;
  actions: Record<GlobalAction, boolean>;
  accounts: Record<string, { actions: Record<AccountAction, boolean> }>;
  machines: Record<string, { actions: Record<MachineAction, boolean> }>;
}

export type GlobalAction = "accounts.create";

export type AccountAction =
  | "account.read"
  | "account.settings.write"
  | "account.delete"
  | "account.leave"
  | "account.members.read"
  | "account.members.write"
  | "account.members.remove"
  | "account.members.limit"
  | "account.invites"
  | "account.machines.list"
  | "account.machines.create"
  | "account.machines.receive"
  | "account.billing.write"
  | "account.providers.read"
  | "account.providers.write"
  | "account.personalPlan.start";

export type MachineAction =
  | "machine.read"
  | "machine.files.read"
  | "machine.files.write"
  | "machine.meta.write"
  | "machine.agents.read"
  | "machine.agents.write"
  | "machine.ai.run"
  | "machine.schedule.run"
  | "machine.connections.use"
  | "machine.exec"
  | "machine.fetch"
  | "machine.stop"
  | "machine.settings.write"
  | "machine.hostname.write"
  | "machine.type.write"
  | "machine.copy"
  | "machine.move"
  | "machine.delete"
  | "machine.leave"
  | "machine.members.read"
  | "machine.members.write"
  | "machine.owner.write"
  | "machine.members.remove"
  | "machine.pendingMembers.read"
  | "machine.invites"
  | "machine.checkpoints.read"
  | "machine.checkpoints.restore"
  | "machine.connections.read"
  | "machine.connections.write"
  | "machine.webdavCredentials.read"
  | "machine.webdavCredentials.create"
  | "machine.webdavCredentials.revokeOwn"
  | "machine.webdavCredentials.manageAll";
