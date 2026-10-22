import type {
  AccountInvite,
  AccountMachine,
  AccountMember,
  AccountRole,
  AutoRecharge,
  CreateAccountInvite,
  CreatedAccountInvite,
  MachineInviteRole,
  Providers,
  RoolAccount,
} from "./types.js";

export interface AccountTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AccountMembersApi {
  list(): Promise<AccountMember[]>;
  /** Admins only. An account always keeps one admin. */
  setRole(userId: string, role: AccountRole): Promise<AccountRole>;
  /** Admins only, on any member including themselves; null lifts the cap. */
  setDailyLimit(userId: string, usd: number | null): Promise<number | null>;
  /** An admin removing someone, or a member leaving with their own user id.
   *  The member leaves every machine of the account; machines they own there
   *  need another owner first. No one leaves their home account. */
  remove(userId: string): Promise<void>;
}

export interface AccountInvitesApi {
  list(): Promise<AccountInvite[]>;
  /** Only teams take invites. */
  create(invite: CreateAccountInvite): Promise<CreatedAccountInvite>;
  revoke(inviteId: string): Promise<void>;
  /** Put an open invite's taker on a machine of the team, or change the role. */
  setMachine(
    inviteId: string,
    machineId: string,
    role: MachineInviteRole,
  ): Promise<void>;
  removeMachine(inviteId: string, machineId: string): Promise<void>;
}

/** An account the user is on the roster of. Members see the roster; its
 *  admins also rename it, see all its machines, and invite. */
export class RoolAccountApi {
  readonly members: AccountMembersApi;
  readonly invites: AccountInvitesApi;
  private readonly path: string;

  constructor(
    readonly id: string,
    private readonly transport: AccountTransport,
  ) {
    if (!id) throw new Error("accountId is required");
    this.path = `/v2/accounts/${encodeURIComponent(id)}`;
    this.members = new AccountMembersClient(this.path, transport);
    this.invites = new AccountInvitesClient(this.path, transport);
  }

  get(): Promise<RoolAccount> {
    return this.transport.requestJson(this.path);
  }

  /** Standard with its start credits on a home account whose plan is `none`;
   *  `personal_plan_exists` otherwise, `not_home_account` off the home account. */
  startPersonalPlan(): Promise<RoolAccount> {
    return this.transport.requestJson(`${this.path}/personal-plan`, {
      method: "POST",
    });
  }

  /** The account's provider policy, which applies to everyone on its machines, whoever pays. */
  getProviders(): Promise<Providers> {
    return this.transport.requestJson(`${this.path}/providers`);
  }

  /** Admins only; `provider_not_found` for an id that is not switchable. */
  async setProviderEnabled(id: string, enabled: boolean): Promise<void> {
    await this.transport.request(
      `${this.path}/providers/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    );
  }

  rename(name: string): Promise<RoolAccount> {
    return this.transport.requestJson(this.path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  /** Delete a team, as one of its admins. Refused while it pays for any
   *  machines; its roster, invites and history go with it, and its balance is
   *  forfeit. A home account goes only with its user. */
  async delete(): Promise<void> {
    await this.transport.request(this.path, { method: "DELETE" });
  }

  /** A Stripe Checkout URL where an admin adds whole dollars to a team's
   *  balance, from 10 to 1000, tax on top. Paying saves the card for
   *  auto-recharge. The amount is dollars, not the id of a consumer credit
   *  pack from `PlanCatalog.topUps`. */
  async topUp(amountUsd: number): Promise<string> {
    const { url } = await this.transport.requestJson<{ url: string }>(
      `${this.path}/top-ups`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd }),
      },
    );
    return url;
  }

  /** Turn a team's auto-recharge on, or change it, as an admin. It charges
   *  the card of the last top-up (`no_saved_card` before there is one). */
  setAutoRecharge({
    thresholdUsd,
    amountUsd,
  }: AutoRecharge): Promise<RoolAccount> {
    return this.transport.requestJson(`${this.path}/auto-recharge`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thresholdUsd, amountUsd }),
    });
  }

  async stopAutoRecharge(): Promise<void> {
    await this.transport.request(`${this.path}/auto-recharge`, {
      method: "DELETE",
    });
  }

  /** Every machine the account pays for, members or not. Admins only. */
  async listMachines(): Promise<AccountMachine[]> {
    const { machines } = await this.transport.requestJson<{
      machines: AccountMachine[];
    }>(`${this.path}/machines`);
    return machines;
  }
}

class AccountMembersClient implements AccountMembersApi {
  constructor(
    private readonly accountPath: string,
    private readonly transport: AccountTransport,
  ) {}

  async list(): Promise<AccountMember[]> {
    const { members } = await this.transport.requestJson<{
      members: AccountMember[];
    }>(`${this.accountPath}/members`);
    return members;
  }

  async setRole(userId: string, role: AccountRole): Promise<AccountRole> {
    const result = await this.transport.requestJson<{ role: AccountRole }>(
      `${this.memberPath(userId)}/role`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      },
    );
    return result.role;
  }

  async setDailyLimit(
    userId: string,
    usd: number | null,
  ): Promise<number | null> {
    if (usd !== null && !(Number.isFinite(usd) && usd >= 0))
      throw new Error("usd must be a dollar amount from 0 up, or null");
    const result = await this.transport.requestJson<{
      dailyLimitUsd: number | null;
    }>(`${this.memberPath(userId)}/limit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLimitUsd: usd }),
    });
    return result.dailyLimitUsd;
  }

  async remove(userId: string): Promise<void> {
    await this.transport.request(this.memberPath(userId), { method: "DELETE" });
  }

  private memberPath(userId: string): string {
    return `${this.accountPath}/members/${encodeURIComponent(userId)}`;
  }
}

class AccountInvitesClient implements AccountInvitesApi {
  constructor(
    private readonly accountPath: string,
    private readonly transport: AccountTransport,
  ) {}

  async list(): Promise<AccountInvite[]> {
    const { invites } = await this.transport.requestJson<{
      invites: AccountInvite[];
    }>(`${this.accountPath}/invites`);
    return invites;
  }

  create(invite: CreateAccountInvite): Promise<CreatedAccountInvite> {
    return this.transport.requestJson(`${this.accountPath}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite),
    });
  }

  async revoke(inviteId: string): Promise<void> {
    await this.transport.request(this.invitePath(inviteId), {
      method: "DELETE",
    });
  }

  async setMachine(
    inviteId: string,
    machineId: string,
    role: MachineInviteRole,
  ): Promise<void> {
    await this.transport.request(this.machinePath(inviteId, machineId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  }

  async removeMachine(inviteId: string, machineId: string): Promise<void> {
    await this.transport.request(this.machinePath(inviteId, machineId), {
      method: "DELETE",
    });
  }

  private invitePath(inviteId: string): string {
    return `${this.accountPath}/invites/${encodeURIComponent(inviteId)}`;
  }

  private machinePath(inviteId: string, machineId: string): string {
    return `${this.invitePath(inviteId)}/machines/${encodeURIComponent(machineId)}`;
  }
}
