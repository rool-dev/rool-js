/** The known plans, and any the server adds later; `none` is a home account before `startPersonalPlan`. */
export type RoolPlan =
  "none" | "standard" | "plus" | "pro" | "team" | (string & {});
export type ClientCompatibility = "ok" | "unsupported";

/** Current or last subscription. The account's plan, not this status, decides access. */
export interface AccountSubscription {
  provider: "stripe" | "apple";
  status: "active" | "cancelling" | "past_due" | "ended" | "unknown";
}

/** The signed-in person. Plans and balances belong to accounts. */
export interface RoolUser {
  id: string;
  email: string;
  photoUrl: string | null;
  totalCreditsUsed: number;
  createdAt: string;
  lastActivity: string | null;
}

/** An account the user is a member of: what pays, and on which plan. */
export interface RoolAccount {
  id: string;
  /** A team's name; null for a home account without one. */
  name: string | null;
  /** The user's own account, created when they signed up. */
  home: boolean;
  role: "admin" | "member";
  /** The most the user may spend on the account in any 24 hours; null for no cap. */
  dailyLimitUsd: number | null;
  /** The user's charges on the account in the last 24 hours; 0 on a home account. */
  spentUsd: number;
  plan: RoolPlan;
  balanceUsd: number;
  /** The balance in credits, the unit Rool.app shows. */
  balanceCredits: number;
  subscription: AccountSubscription | null;
  /** A team's automatic top-up: below the threshold, the saved card buys the
   *  amount, in dollars. Null when off. */
  autoRecharge: AutoRecharge | null;
  /** Whether a team has a card saved by a top-up, which auto-recharge needs. */
  savedCard: boolean;
  /** When a team's debt shut its machines; null while they may run. A top-up
   *  that pays the debt opens it again. */
  shutAt: string | null;
  /** End of a granted (not bought) plan, past or present; null if never granted. */
  compedUntil: string | null;
  /** The last hourly refill, or the account's creation on plans without one. */
  refilledAt: string;
}

export interface AutoRecharge {
  thresholdUsd: number;
  amountUsd: number;
}

/** @deprecated The user mixed with their home account. Use `RoolUser` and `RoolAccount`. */
export interface UserAccount {
  id: string;
  email: string;
  photoUrl: string | null;
  /** @deprecated Use `RoolAccount.plan`. */
  plan: RoolPlan;
  /** @deprecated Use `RoolAccount.balanceCredits`. */
  creditsBalance: number;
  totalCreditsUsed: number;
  createdAt: string;
  lastActivity: string | null;
  /** @deprecated Use `RoolAccount.refilledAt`. */
  processedAt: string;
  /** @deprecated Use `RoolAccount.subscription`. */
  stripeStatus: string | null;
  /** @deprecated Use `RoolAccount.subscription`. */
  subscription: AccountSubscription | null;
}

export interface UserProfile {
  name: string | null;
  marketingOptIn: boolean;
}

export type UserAppData = Record<string, unknown>;

export interface ProviderDisclosure {
  id: string;
  name: string;
  vendor: string;
  whatIsSent: string;
  usedFor: string[];
}

export interface OptionalProvider extends ProviderDisclosure {
  whenOff: string;
  enabled: boolean;
}

/** All copy is server-written disclosure text; render it as-is. */
export interface Providers {
  always: ProviderDisclosure[];
  optional: OptionalProvider[];
}

/** New tiers may appear without an SDK release; treat an unknown one as "medium". */
export type ModelEffortCost = "low" | "medium" | "high" | (string & {});

export interface ModelEffort {
  id: string;
  name: string;
  description: string;
  /** A short icon name; fall back to a generic icon for one you don't know. */
  icon: string;
  cost: ModelEffortCost;
}

export interface Model {
  id: string;
  name: string;
  description: string;
  defaultEffort: string;
  /** Lightest first. */
  efforts: ModelEffort[];
}

export interface Price {
  amount: number;
  /** ISO 4217. */
  currency: string;
}

/** How the caller buys, decided by the server from their platform, country
 *  and any Stripe subscription they have: on the web in a currency, or
 *  through the App Store.
 *  Prices show either way; `forSale` says whether the caller may buy here, so
 *  a buy button becomes "not available in your country" where it is false,
 *  and `teams` whether they may start and fund a team (`team_not_available`).
 *  Treat a kind you don't know as not for sale. */
export type Market =
  | { kind: "stripe"; currency: string; forSale: boolean; teams: boolean }
  | { kind: "apple"; forSale: boolean; teams: boolean };

/** How something is bought in the caller's market: a price on the web, or a
 *  product in the App Store, whose price comes from StoreKit. */
export interface Offer {
  price: Price | null;
  appleProductId: string | null;
}

/** A plan as the server sells and enforces it. `id` matches `RoolAccount.plan`;
 *  plans are added without an SDK release, so it is an open string. */
export interface PlanDefinition {
  id: string;
  /** Server-written; render it as-is. */
  name: string;
  /** The monthly subscription in the caller's market; null for a plan not
   *  sold there, such as a free one. */
  subscription: Offer | null;
  /** Plan ids to offer this plan's subscribers, cheapest first. Stepping down
   *  goes through the store's subscription management. */
  upgrades: string[];
  startCredits: number;
  hourlyCredits: number;
  /** The refill stops here; top-ups may go above it. */
  maxCredits: number;
  /** Machines the account may pay for; null for no limit. */
  maxMachines: number | null;
  machine: {
    type: string;
    memoryMib: number;
    vcpus: number;
    storageBytes: number;
  };
  customHostname: boolean;
  mcp: boolean;
}

/** A top-up in the caller's market. */
export interface TopUpDefinition extends Offer {
  id: string;
  credits: number;
}

/** A type a team machine may have, with its rent in dollars, the currency of
 *  a team's balance. */
export interface MachineTypeDefinition {
  type: string;
  memoryMib: number;
  vcpus: number;
  storageBytes: number;
  monthlyRent: Price;
  /** False for a type that cannot be chosen yet. */
  available: boolean;
}

export interface PlanCatalog {
  market: Market;
  plans: PlanDefinition[];
  topUps: TopUpDefinition[];
  machineTypes: MachineTypeDefinition[];
  usage: UsagePricing;
}

/** What calls cost, in dollars, whoever pays and in whatever market. */
export interface UsagePricing {
  currency: "USD";
  /** A credit's worth, for showing a price in Rool.app's unit. */
  usdPerCredit: number;
  /** Every model first, then the other items, in display order. */
  prices: UsagePrice[];
}

export type UsagePrice = { id: string; name: string } & (
  | {
      kind: "tokens";
      inputPer1M: number;
      cachedPer1M: number;
      outputPer1M: number;
    }
  | { kind: "unit"; unit: string; perUnit: number }
);

/** All copy is server-written; render it as-is. */
export interface ModelCatalog {
  default: string;
  models: Model[];
}

export type MachineRole = "owner" | "admin" | "editor" | "viewer";
export type MachineLifecycleState = "active" | "locked";
export type MachineMeta = Record<string, unknown>;

export interface MachineSummary {
  id: string;
  name: string;
  hostname: string;
  webDavUrl: string;
  inboundEmailAddress: string;
  nextInboundEmailAddress?: string;
  meta: MachineMeta;
  role: MachineRole;
  ownerId: string;
  /** The account that pays for the machine. */
  accountId: string;
  /** The account that pays for the user's work on it: the machine's account
   *  when they are on its roster, their home account otherwise. */
  payingAccountId: string;
  /** The hardware it boots with: its own type on a team, its plan's elsewhere. */
  machineType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  state: MachineLifecycleState;
}

export interface MachineSettings {
  name: string;
}

export interface MachineCreation extends MachineSettings {
  /** A team machine's type, from `PlanCatalog.machineTypes`; required on a
   *  team, refused elsewhere. A copy on a team defaults to the original's. */
  type?: string | null;
  /** An account the user is on the roster of; by default their home account
   *  (a duplicate goes where its original's work is paid from). */
  accountId?: string | null;
}

export interface MachineCheckpoint {
  id: string;
  createdAt: string;
  /** Set on the checkpoint a restore created: when the restored checkpoint was taken. Kept after that checkpoint is thinned out. */
  restoredFrom: string | null;
  /** The state a restore replaced. Restore it to undo that restore. */
  preRestore: boolean;
}

export interface MachineCheckpointRestore {
  /** The newest checkpoint: the one the restore created, or the target itself when nothing changed. */
  checkpoint: MachineCheckpoint;
  /** The checkpoint holding the replaced state, or null when the machine was already at the target. */
  replacedCheckpointId: string | null;
}

/**
 * The machine's own view of its CPU and memory. CPU time is cumulative: load over an
 * interval is Δ`cpuBusySeconds` / (Δ`uptimeSeconds` × `vcpus`) between two readings.
 * `uptimeSeconds` is a counter for that formula, not how long the machine has been up.
 */
export type MachineResources =
  | { running: false }
  | {
      running: true;
      vcpus: number;
      cpuBusySeconds: number;
      uptimeSeconds: number;
      memTotalBytes: number;
      memAvailableBytes: number;
    };

/** Allocated bytes per part of the machine disk; they add up to `usedBytes`. */
export interface MachineStorageAreas {
  files: number;
  conversations: number;
  objects: number;
  /** Members' home folders, when they are kept on the machine disk. */
  home: number;
  /** Filesystem metadata and the machine's own state. */
  other: number;
}

export interface MachineStorage {
  usedBytes: number;
  planBytes: number;
  /** Room left under the plan; 0 while over it, never negative. */
  availableBytes: number;
  /** Set while usage is over the plan; writes stop at this time until usage is back under it. */
  graceEndsAt: string | null;
  areas: MachineStorageAreas;
}

export interface MachineMember {
  userId: string;
  email: string;
  name: string | null;
  role: MachineRole;
  photoUrl: string | null;
}

export interface MachineMemberRoleConfiguration {
  role: MachineRole;
}

export type MachineInviteRole = Exclude<MachineRole, "owner">;
export type MachineInviteEmailStatus =
  "sent" | "not_configured" | "failed" | "cooldown" | "rate_limited";

export interface MachineInvite {
  id: string;
  role: MachineInviteRole;
  email: string | null;
  createdById: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
}

export interface CreateMachineInvite {
  role: MachineInviteRole;
  email?: string | null;
  expiresInDays?: number | null;
  maxUses?: number | null;
}

export interface CreatedMachineInvite extends MachineInvite {
  url: string;
  emailStatus: MachineInviteEmailStatus | null;
}

export interface MachineInvitePreview {
  machineId: string;
  machineName: string;
  role: MachineInviteRole;
  email: string | null;
  inviterName: string | null;
}

export interface McpProvider {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
}

export type McpConnectionAuthentication =
  | { type: "none" }
  | { type: "headers"; headers: Record<string, string> }
  | { type: "oauth"; clientId?: never; clientSecret?: never }
  | { type: "oauth"; clientId: string; clientSecret: string };

export type McpConnectionAuthenticationSummary =
  | { type: "none" }
  | { type: "headers"; headerNames: string[] }
  | {
      type: "oauth";
      authorized: boolean;
      clientId?: boolean;
      clientSecret?: boolean;
    };

export interface McpConnection {
  id: string;
  name: string;
  description?: string;
  hostname: string;
  /** @deprecated Use hostname. This contains only the hostname, not the full endpoint URL. */
  url: string;
  logoUrl?: string;
  authentication: McpConnectionAuthenticationSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomMcpConnection {
  name: string;
  /** Optional description, at most 160 characters after whitespace normalization. */
  description?: string;
  /** Full HTTPS endpoint URL. Responses expose only its hostname. */
  url: string;
  authentication: McpConnectionAuthentication;
}

export type CreateMcpConnection = CreateCustomMcpConnection;

export interface McpAuthorization {
  authorizationUrl: string;
  expiresAt: string;
}

export type InviteRedemptionStatus = "joined" | "upgraded" | "already_member";

export type AccountRole = "admin" | "member";

export interface AccountMember {
  userId: string;
  email: string;
  name: string | null;
  photoUrl: string | null;
  role: AccountRole;
  joinedAt: string;
  /** The most they may spend on the account in any 24 hours; null for no cap. */
  dailyLimitUsd: number | null;
  /** Their charges on the account in the last 24 hours. */
  spentUsd: number;
}

/** A machine an account pays for, as its admins see it. */
export interface AccountMachine {
  id: string;
  name: string;
  hostname: string;
  ownerId: string;
  /** The admin's own role on it; null when they are not a member. */
  role: MachineRole | null;
  memberCount: number;
  /** The hardware it boots with; its rent is in `getPlans().machineTypes`. */
  machineType: string;
  createdAt: string;
  updatedAt: string;
  state: MachineLifecycleState;
}

/** A machine a team invite puts its taker on when they accept. */
export interface AccountInviteMachine {
  machineId: string;
  role: MachineInviteRole;
}

export interface AccountInvite {
  id: string;
  role: AccountRole;
  email: string | null;
  machines: AccountInviteMachine[];
  createdById: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
}

export interface CreateAccountInvite {
  role: AccountRole;
  email?: string | null;
  expiresInDays?: number | null;
  maxUses?: number | null;
  /** Machines of the team its taker lands on; `machine_not_on_account` for any other, `account_invite_not_found` on a closed invite. */
  machines?: AccountInviteMachine[];
}

/** Someone a team invite will put on the machine when they accept it. */
export interface PendingMachineMember {
  inviteId: string;
  email: string | null;
  role: MachineInviteRole;
  expiresAt: string;
}

export interface CreatedAccountInvite extends AccountInvite {
  url: string;
  emailStatus: MachineInviteEmailStatus | null;
}

export interface AccountInvitePreview {
  accountId: string;
  accountName: string;
  role: AccountRole;
  email: string | null;
  inviterName: string | null;
}

export interface AccountInviteRedemption {
  accountId: string;
  role: AccountRole;
  status: InviteRedemptionStatus;
}

export interface InviteRedemption {
  machineId: string;
  role: MachineRole;
  status: InviteRedemptionStatus;
}

/** What a voucher grants. Kinds are added over time, so clients should prefer
 * the server-rendered description unless they need a kind's structured value. */
export type VoucherPayload = { kind: "credits"; credits: number };

export interface Voucher {
  id: string;
  /** Display form of the code, e.g. "K7M2-9QRT" */
  code: string;
  /** Claim URL carrying the code */
  url: string;
  voucher: VoucherPayload;
  /** The promise as a noun phrase, e.g. "10,000 AI credits" */
  description: string;
  /** Null while unclaimed */
  claimedAt: string | null;
  /** Claimer's display name, when claimed and they have one */
  claimedByName: string | null;
  createdAt: string;
  /** When the voucher expires, if it expires */
  expiresAt: string | null;
  /** The holder's own reminder of what they did with the code */
  note: string | null;
  /** Set when the holder has hidden this voucher; the code still claims */
  archivedAt: string | null;
}

export interface VoucherList {
  vouchers: Voucher[];
}

/** Changes to a voucher's bookkeeping. Undefined leaves a field as it is;
 * note: null clears it. */
export interface VoucherUpdate {
  note?: string | null;
  archived?: boolean;
}

export interface VoucherPreview {
  /** Display name of the person whose voucher this is */
  holderName: string | null;
  voucher: VoucherPayload;
  description: string;
}

export interface VoucherClaimResult {
  /** What the claiming account was granted */
  voucher: VoucherPayload;
  description: string;
}

export interface MachineFetchInit {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ServerInfo {
  version: string;
  minimumSdkVersion: string;
  compatibility: ClientCompatibility;
}

export interface RoolSession {
  user: RoolUser;
  /** The accounts the user is a member of, home account first. */
  accounts: RoolAccount[];
  profile: UserProfile;
  userAppData: UserAppData;
  machines: MachineSummary[];
  syncToken: string;
  server: ServerInfo;
}

export interface Greeting {
  title: string;
  text: string;
}

export interface SpeechmaticsToken {
  /** Short-lived key for the Speechmatics real-time API */
  token: string;
  /** Epoch milliseconds at which the token stops being accepted */
  expiresAt: number;
  /** Token lifetime in seconds */
  ttl: number;
}

export interface SpeechmaticsTokenOptions {
  /** Token lifetime in seconds, between 60 and 3600 (default 300) */
  ttl?: number;
}

export interface RoolRequestTokens {
  accessToken: string;
  roolToken: string;
}

export interface RoolTokenSource {
  readonly getTokens: () => Promise<RoolRequestTokens | undefined>;
}

export interface RoolAuth extends RoolTokenSource {
  initialize(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  login(appName: string, params?: Record<string, string>): Promise<void>;
  signup(appName: string, params?: Record<string, string>): Promise<void>;
  readonly logout: () => Promise<void>;
  onAuthStateChanged(listener: (authenticated: boolean) => void): () => void;
}

export interface RoolClientIdentity {
  appName?: string;
  appVersion?: string;
  osVersion?: string;
}

export interface RoolClientConfig {
  apiUrl?: string;
  /** Supply access and Rool tokens from an auth client. */
  getTokens?: () =>
    | RoolRequestTokens
    | null
    | undefined
    | Promise<RoolRequestTokens | null | undefined>;
  /**
   * Supply only an access token from an external auth client. Prefer getTokens
   * when the auth flow also issues a Rool token.
   */
  getAccessToken?: () =>
    string | null | undefined | Promise<string | null | undefined>;
  /** Called after an API response rejects the current authentication. */
  onAuthInvalidated?: () => void | Promise<void>;
  fetch?: typeof globalThis.fetch;
  client?: RoolClientIdentity;
}

export interface RoolProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
}
