/**
 * Field type descriptor. Recursive structure supporting primitives,
 * enums, literals, arrays, optionals (maybe), and object references.
 */
export type FieldType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'array'; inner?: FieldType }
  | { kind: 'maybe'; inner: FieldType }
  | { kind: 'enum'; values: string[] }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'ref' };

/**
 * A named field definition within a collection.
 */
export interface FieldDef {
  name: string;
  type: FieldType;
}

/**
 * A collection definition — a named set of typed fields.
 */
export interface CollectionDef {
  fields: FieldDef[];
  /** Optional schema.org type name for this collection (e.g. "Person", "MusicAlbum"). */
  schemaOrgType?: string;
}

/**
 * The full schema for a space — a map of collection names to definitions.
 */
export type SpaceSchema = Record<string, CollectionDef>;

/**
 * An object in a space. Objects are JSON files addressed by machine path.
 * References between objects are body fields whose values are paths.
 */
export interface RoolObject {
  /** Canonical machine path, e.g. `/space/article/welcome.json`. */
  path: string;
  /** User-defined fields. */
  body: Record<string, unknown>;
}

/** Result of fetching object bodies in bulk. */
export interface GetObjectsResult {
  objects: RoolObject[];
  missing: string[];
}

/**
 * Audit information for an object — when it was last modified, by whom,
 * and where (conversation/interaction). Returned by `space.stat`.
 */
export interface RoolObjectStat {
  /** Object path these stats apply to. */
  path: string;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInConversation: string | null;
  modifiedInInteraction: string | null;
}

/**
 * A tool call record is keyed by id; running calls have no result, finished calls have a string result.
 */
export type ToolCall = RunningToolCall | FinishedToolCall;

export interface RunningToolCall {
  id: string;
  name: string;      // Tool name ("create_object", "update_object", etc.)
  input: unknown;    // Original args (verbatim)
  status: 'running';
}

export interface FinishedToolCall {
  id: string;
  name: string;      // Tool name ("create_object", "update_object", etc.)
  input: unknown;    // Original args (verbatim)
  status: 'done';
  result: string;    // Stringified, truncated result
}

/**
 * Interaction lifecycle status.
 * - `pending` — Created, work not started yet
 * - `streaming` — Final text response being generated (`output` contains partial text)
 * - `done` — Finished successfully
 * - `error` — Finished with an error
 */
export type InteractionStatus = 'pending' | 'streaming' | 'done' | 'error';

/**
 * An interaction entry - combines request and response in a single record.
 */
export interface Interaction {
  id: string;
  /** Parent interaction in the conversation tree. null = root message. */
  parentId: string | null;
  timestamp: number;
  userId: string;
  userName?: string | null;  // Display name at time of interaction
  operation: 'prompt' | 'putObject' | 'patchObject' | 'moveObject' | 'deleteObjects' | 'deletePaths' | string;
  input: string;
  output: string | null;
  status: InteractionStatus;
  ai: boolean;
  /** Paths of objects affected by this interaction. */
  modifiedObjectPaths: string[];
  toolCalls: ToolCall[];
  /** Canonical rool-machine:/... resource refs attached by the user. */
  attachments?: string[];
}

/**
 * A conversation in a space — holds interaction history and optional system instruction.
 */
export interface Conversation {
  name?: string;
  /** Owning agent's folder name; absent from servers that predate the field. */
  agent?: string;
  visibility?: ConversationVisibility;
  systemInstruction?: string;
  createdAt: number;
  createdBy: string;
  interactions: Record<string, Interaction>;
}

/**
 * Who may see a conversation: 'shared' is every space member; 'private' is
 * owner-only; 'temporary' is private plus auto-delete once it sits idle.
 */
export type ConversationVisibility = 'shared' | 'private' | 'temporary';

/**
 * Lightweight conversation metadata — no interaction bodies. Returned by
 * `openSpace` (as `conversationMeta`) and maintained from SSE events. The
 * `updatedAt` field drives last-activity display without loading any contents.
 */
export interface ConversationMeta {
  id: string;
  /** Owning agent's folder name under /agents ("rool" is the stock agent). */
  agent: string;
  visibility: ConversationVisibility;
  name: string | null;
  systemInstruction: string | null;
  createdAt: number;
  createdBy: string;
  interactionCount: number;
  updatedAt: number;
}



export type RoolUserRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** Roles an invite link can grant (never 'owner') */
export type InviteRole = 'admin' | 'editor' | 'viewer';

export interface RoolSpaceInfo {
  id: string;
  name: string;
  inboundEmailAddress: string;
  role: RoolUserRole;
  ownerId: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface SpaceInvite {
  inviteId: string;
  spaceId: string;
  role: InviteRole;
  /** Set when the invite is guarded to a specific email address */
  email: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
}

/**
 * Outcome of the invite email send. Null when no email was involved (open link).
 * The invite is always minted and its `url` is usable regardless of this value;
 * only the email delivery is reflected here.
 * - 'sent': email dispatched
 * - 'not_configured': server has no mail provider (local dev)
 * - 'failed': provider rejected the send
 * - 'cooldown': a recent invite to this same address was already emailed
 * - 'rate_limited': the inviter hit their daily email-invite cap
 * Treat unknown values as not sent.
 */
export type InviteEmailStatus =
  | 'sent'
  | 'not_configured'
  | 'failed'
  | 'cooldown'
  | 'rate_limited'
  | (string & {});

export interface SpaceInviteCreated {
  inviteId: string;
  spaceId: string;
  role: InviteRole;
  email: string | null;
  expiresAt: string;
  maxUses: number | null;
  /** Join URL containing the secret token; only available at mint time */
  url: string;
  emailStatus: InviteEmailStatus | null;
}

export interface InvitePreview {
  spaceId: string;
  spaceName: string;
  role: InviteRole;
  email: string | null;
  inviterName: string | null;
}

export interface InviteRedeemResult {
  spaceId: string;
  role: RoolUserRole;
  status: 'joined' | 'upgraded' | 'already_member';
}

export interface SpaceMember {
  id: string;
  email: string;
  role: RoolUserRole;
  photoUrl: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  photoUrl: string | null;
  slug: string;
  plan: string;
  creditsBalance: number;
  totalCreditsUsed: number;
  createdAt: string;
  lastActivity: string;
  processedAt: string;
  storage: Record<string, unknown>;
  stripeStatus: string | null;
  marketingOptIn: boolean;
}

/**
 * Effort level for AI operations.
 * - 'QUICK': Fast responses, read-only (no object mutations)
 * - 'STANDARD': Default behavior with full capabilities
 * - 'REASONING': Extended reasoning for complex tasks
 * - 'RESEARCH': Pre-analysis and context gathering (reserved for future use)
 */
export type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';

export type PromptAttachment = File | Blob | { data: string; contentType: string; filename?: string } | string;

export interface PromptOptions {
  responseSchema?: Record<string, unknown>;
  /** Effort level for the AI operation. Defaults to 'STANDARD'. */
  effort?: PromptEffort;
  /** Parent interaction in the conversation tree. Omit to auto-continue from the active leaf. Pass null to start a new root-level branch. */
  parentInteractionId?: string | null;
  /**
   * Client-supplied interaction id. The server echoes this id back on the
   * resulting interaction, so a caller can render an optimistic message keyed by
   * it and reconcile the server's copy in place (no unmount/remount). Defaults to
   * an internally-generated id. Use {@link generateEntityId} to mint one.
   */
  interactionId?: string;
  /** If true, the prompt won't be recorded in interaction history. Useful for transient operations like tab completion. */
  ephemeral?: boolean;
  /** If true, mutation tools (create, update, delete) are disabled. Defaults to false. */
  readOnly?: boolean;
  /**
   * Resources to attach to the prompt.
   *
   * Pass existing machine paths for objects (`/space/...`) or files
   * (`/rool-drive/...`). Local File, Blob, or base64 inputs are uploaded to
   * authenticated space file storage first; the resulting file paths are sent
   * to the server as canonical `rool-machine:/...` refs.
   *
   * Supported file types for AI viewing:
   * - **Images** (JPEG, PNG, GIF, WebP, SVG) — viewed natively by the AI
   * - **PDFs** — viewed natively by the AI
   * - **Text files** (TXT, Markdown, CSV, JSON, XML, HTML) — read as text
   * - **DOCX** — text extracted and read by the AI
   */
  attachments?: PromptAttachment[];
  /**
   * Abort signal to stop the in-flight prompt. When aborted, the server stops
   * the agent loop and closes the stream; note that any LLM turn already in
   * flight on Vertex keeps generating server-side and is billed.
   */
  signal?: AbortSignal;
  /** Telemetry event for this prompt. Default `'prompt_user'`; override for
   *  app-initiated prompts (e.g. `'prompt_onboarding_seed'`). Only `'prompt_user'`
   *  counts toward active-user metrics. */
  eventName?: string;
}

export interface CollectionOptions {
  /** Optional schema.org type name for this collection (e.g. "Person", "MusicAlbum"). */
  schemaOrgType?: string;
}

export interface UpdateObjectOptions {
  /** Fields to add or update. Pass null/undefined to delete a field. Fields prefixed with `_` are hidden from AI. */
  data?: Record<string, unknown>;
}

export interface MoveObjectOptions {
  /** Replace the body atomically as part of the move. If omitted, the body is preserved. */
  body?: Record<string, unknown>;
}

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export type ClientCompatibility = 'ok' | 'unsupported';

export type RoolEventSource = 'user' | 'agent';

export type ClientEventType = 'connected' | 'space_created' | 'space_deleted' | 'space_renamed' | 'space_access_changed' | 'user_storage_changed';

interface ClientEventBase {
  timestamp: number;
}

export interface ConnectedClientEvent extends ClientEventBase {
  type: 'connected';
  serverVersion: string;
  minimumSdkVersion?: string | null;
  compatibility?: ClientCompatibility;
}

export interface SpaceCreatedClientEvent extends ClientEventBase {
  type: 'space_created';
  spaceId: string;
  name: string;
  inboundEmailAddress?: string;
  ownerId?: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  role?: string;
}

export interface SpaceDeletedClientEvent extends ClientEventBase {
  type: 'space_deleted';
  spaceId: string;
}

export interface SpaceRenamedClientEvent extends ClientEventBase {
  type: 'space_renamed';
  spaceId: string;
  name: string;
}

export interface SpaceAccessChangedClientEvent extends ClientEventBase {
  type: 'space_access_changed';
  spaceId: string;
  name: string;
  inboundEmailAddress: string;
  ownerId: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  role: string;
  memberCount: number;
}

export interface UserStorageChangedClientEvent extends ClientEventBase {
  type: 'user_storage_changed';
  key: string;
  value: unknown;
}

export type ClientEvent =
  | ConnectedClientEvent
  | SpaceCreatedClientEvent
  | SpaceDeletedClientEvent
  | SpaceRenamedClientEvent
  | SpaceAccessChangedClientEvent
  | UserStorageChangedClientEvent;

export type SpaceEventType =
  | 'connected'
  | 'conversation_updated'
  | 'space_files_changed'
  | 'space_files_reset';


export interface SpaceEvent {
  type: SpaceEventType;
  spaceId: string;
  timestamp: number;
  source: RoolEventSource;
  // Conversation events
  conversationId?: string;
  conversation?: Conversation;
  // Connected events
  serverVersion?: string;
}

/**
 * Result of an email+password sign-in.
 * - `signed_in`: tokens issued, the user is now authenticated.
 * - `verify_required`: the account's email isn't verified yet; a magic link
 *   has been emailed and the user must complete verification before signing in.
 */
export type PasswordSignInResult = { status: 'signed_in' | 'verify_required' };

/**
 * External auth provider interface for Electron or custom auth flows.
 * When provided, the SDK delegates all auth operations to this provider.
 */
export interface AuthProvider {
  /** Initialize the provider (e.g. check for callbacks, start timers) */
  initialize?: () => boolean;
  /** Get current access token and rool token. Returns undefined if not authenticated. */
  getTokens: () => Promise<{ accessToken: string; roolToken: string } | undefined>;
  /** Get auth identity from current session (decoded from token) */
  getAuthUser: () => { email: string | null; name: string | null };
  /** Check if currently authenticated (validates token is usable) */
  isAuthenticated: () => Promise<boolean>;
  /** Initiate login with application name */
  login: (appName: string, params?: Record<string, string>) => Promise<void> | void;
  /** Initiate signup with application name */
  signup: (appName: string, params?: Record<string, string>) => Promise<void> | void;
  /**
   * Complete an email verification flow. Exchanges a verify JWT (from the
   * verification email link) for a live session and signs the user in.
   * Optional: providers that don't implement it will reject the call.
   */
  verify?: (token: string) => Promise<boolean>;
  /**
   * Complete a native deep-link auth callback (PKCE). The app calls this from
   * its platform deep-link handler with the full callback URL. Optional:
   * providers that don't implement it reject the call.
   */
  handleRedirect?: (url: string) => Promise<boolean>;
  /**
   * Sign in with email + password. Resolves to `signed_in` (authenticated) or
   * `verify_required` (magic link emailed); rejects on bad credentials.
   * Optional: providers that don't implement it reject the call.
   */
  signInWithPassword?: (email: string, password: string) => Promise<PasswordSignInResult>;
  /**
   * Request a magic sign-in link by email. Resolves once the email is accepted,
   * rejects if the address is rejected. Completion happens later via `verify`.
   * Optional: providers that don't implement it reject the call.
   */
  requestMagicLink?: (email: string) => Promise<void>;
  /** Logout and clear session */
  logout: () => void;
  /** Clean up resources (e.g. stop timers) */
  destroy?: () => void;
  /** Optional: receive the resolved auth URL from the client. */
  setAuthUrl?: (url: string) => void;
  /** Optional: receive the client's logger. */
  setLogger?: (logger: import('./logger.js').Logger) => void;
  /**
   * Optional: receive the client's auth-state handler so provider-driven
   * sign-in/out (and 401 token clearing) reach client events and state.
   */
  setAuthStateChangedHandler?: (handler: (authenticated: boolean) => void) => void;
}

export interface RoolClientIdentity {
  /** Application name, e.g. com.example.app or my-web-app. */
  appName?: string;
  /** Application version, e.g. 1.4.2. */
  appVersion?: string;
  /** Operating system version, e.g. iOS 17.5 or Android 15. */
  osVersion?: string;
}

export interface ServerInfo {
  version: string;
  minimumSdkVersion?: string | null;
  compatibility: ClientCompatibility;
}

export interface RoolClientConfig {
  /**
   * API server URL (default: `'https://api.rool.dev'`).
   *
   * The auth URL is derived by stripping the `api.` hostname prefix
   * (e.g. `https://api.rool.dev` → `https://rool.dev/auth`). For local
   * development where the API runs on a different host, set `authUrl`
   * explicitly.
   */
  apiUrl?: string;
  /** @deprecated Use `apiUrl` instead. */
  baseUrl?: string;
  /** Override GraphQL endpoint (default: `{apiUrl}/graphql`) */
  graphqlUrl?: string;
  /** Override auth endpoint (derived from `apiUrl` by stripping `api.` prefix) */
  authUrl?: string;
  /** Application identity sent with SDK requests. */
  client?: RoolClientIdentity;
  /**
   * External auth provider.
   * When provided, the SDK uses this instead of built-in browser auth.
   */
  authProvider?: AuthProvider;
  /**
   * Logger for SDK diagnostic messages.
   * By default only errors are logged. Pass `console` for full output,
   * or any object with `{ debug, info, warn, error }` methods.
   */
  logger?: import('./logger.js').Logger;
}

/** Source of a user storage change */
export type UserStorageSource = 'local' | 'remote';

/** Event payload for user storage changes */
export interface UserStorageChangedEvent {
  key: string;
  value: unknown;
  source: UserStorageSource;
}

/**
 * Client-level events (space lifecycle, auth, connection, user storage).
 */
export interface RoolClientEvents {
  /** Emitted when authentication state changes */
  authStateChanged: (authenticated: boolean) => void;
  /** Emitted when the current user profile is (re)hydrated, updated, or cleared */
  currentUserChanged: (user: CurrentUser | null) => void;
  /** Emitted when a space is added to the user's list (created or access granted) */
  spaceAdded: (space: RoolSpaceInfo) => void;
  /** Emitted when a space is removed from the user's list (deleted or access revoked) */
  spaceRemoved: (spaceId: string) => void;
  /** Emitted when a space is renamed (by any client) */
  spaceRenamed: (spaceId: string, newName: string) => void;
  /** Emitted when user storage changes (local or remote) */
  userStorageChanged: (event: UserStorageChangedEvent) => void;
  /** Emitted when SSE connection state changes */
  connectionStateChanged: (state: ConnectionState) => void;
  /** Emitted when server identity or compatibility changes */
  serverInfoChanged: (info: ServerInfo) => void;
  /** Emitted when this SDK is older than the server's minimum supported SDK version */
  unsupported: (info: ServerInfo) => void;
  /** Emitted on errors */
  error: (error: Error, context?: string) => void;
  /** Index signature for EventEmitter compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
}

export interface SpaceFilesChangedEvent {
  spaceId: string;
  source: RoolEventSource;
  timestamp: number;
}

export interface RoolSpaceEvents extends SpaceContentEvents {
  /** File storage changed; call webdav.syncCollection() to reconcile. */
  filesChanged: (event: SpaceFilesChangedEvent) => void;
  /** WebDAV sync tokens were invalidated; discard local tokens and full-resync. */
  filesReset: (event: SpaceFilesChangedEvent) => void;
  /** SSE connection state changed */
  connectionStateChanged: (state: ConnectionState) => void;
  /** Index signature for EventEmitter compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
}

/**
 * Source of a space change event.
 * - 'local_user': This client made the change
 * - 'remote_user': Another user/client made the change
 * - 'remote_agent': AI agent made the change
 * - 'system': Resync after error
 */
export type ChangeSource = 'local_user' | 'remote_user' | 'remote_agent' | 'system';

export interface ResetEvent {
  source: ChangeSource;
}



export interface ConversationUpdatedEvent {
  conversationId: string;
  /** The full conversation payload from SSE, or `null` when deleted. Reactive
   *  consumers can read interaction status (e.g. the thinking dot) straight from
   *  this without opening a conversation handle. */
  conversation: Conversation | null;
  source: ChangeSource;
}

/**
 * Space content events (conversations and resets). Schema and metadata have no
 * events here — they live in the filesystem (`/space/<collection>/.schema.json`,
 * `/space/.meta.json`) and reactive consumers re-read them when the file tree
 * reports a change. Object/file reactivity is exposed via `filesChanged` /
 * `filesReset` plus WebDAV `syncCollection()`.
 */
export interface SpaceContentEvents {
  /** Conversation interaction history was updated */
  conversationUpdated: (event: ConversationUpdatedEvent) => void;
  /** Full state replacement (undo/redo, resync) */
  reset: (event: ResetEvent) => void;
  /** Emitted when a sync error occurs */
  syncError: (error: Error) => void;
  /** Index signature for EventEmitter compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
}


export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface AuthUser {
  email: string | null;
  name: string | null;
}
