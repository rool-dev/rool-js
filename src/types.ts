export type RoolPlan = "standard" | "plus" | "pro" | "max" | "admin";
export type ClientCompatibility = "ok" | "unsupported";

export interface UserAccount {
  id: string;
  email: string;
  photoUrl: string | null;
  plan: RoolPlan;
  creditsBalance: number;
  totalCreditsUsed: number;
  createdAt: string;
  lastActivity: string | null;
  processedAt: string;
  stripeStatus: string | null;
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
  size: number;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  state: MachineLifecycleState;
}

export interface MachineSettings {
  name: string;
}

export interface MachineCheckpoint {
  id: string;
  createdAt: string;
}

export interface MachineCheckpointCollection {
  checkpoints: MachineCheckpoint[];
  baseCheckpointId: string | null;
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

export interface McpConnectionTemplateAccessOption {
  id: string;
  name: string;
  description: string;
}

export interface McpConnectionTemplate {
  id: string;
  name: string;
  description: string;
  url: string;
  authentication: "oauth";
  defaultConnectionName: string;
  defaultAccess: string;
  accessOptions: McpConnectionTemplateAccessOption[];
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
      access?: string;
    };

export interface McpConnection {
  id: string;
  name: string;
  url: string;
  authentication: McpConnectionAuthenticationSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomMcpConnection {
  name: string;
  url: string;
  authentication: McpConnectionAuthentication;
}

export interface CreateMcpConnectionFromTemplate {
  templateId: string;
  name?: string;
  access?: string;
}

export type CreateMcpConnection =
  CreateCustomMcpConnection | CreateMcpConnectionFromTemplate;

export interface McpAuthorization {
  authorizationUrl: string;
  expiresAt: string;
}

export type InviteRedemptionStatus = "joined" | "upgraded" | "already_member";

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
  account: UserAccount;
  profile: UserProfile;
  userAppData: UserAppData;
  machines: MachineSummary[];
  accountSyncToken: string;
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

export type PasswordSignInResult = {
  status: "signed_in" | "verify_required";
};

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
