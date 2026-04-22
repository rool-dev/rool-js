// =============================================================================
// Rool Client Types
// Generic types for space-based applications using the Rool server API
// =============================================================================

// =============================================================================
// Collection Schema Types
// =============================================================================

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
}

/**
 * The full schema for a space — a map of collection names to definitions.
 */
export type SpaceSchema = Record<string, CollectionDef>;

// =============================================================================
// Object Types
// =============================================================================

/**
 * Object data - the user content portion of an object.
 * Always contains `id` (the object's unique identifier) and `type`
 * (a string naming the collection the object belongs to). The server
 * validates the object's other fields against that collection's
 * definition; a missing or unknown `type` is rejected.
 * Other fields are application-defined.
 */
export interface RoolObject {
  id: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Object stat - audit information about an object.
 * Returned by space.stat(objectId).
 */
export interface RoolObjectStat {
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
}

/**
 * A tool call record - captures what the agent did during an interaction.
 */
export interface ToolCall {
  name: string;      // Tool name ("create_object", "update_object", etc.)
  input: unknown;    // Original args (verbatim)
  result?: string;   // Stringified, truncated result (absent while tool is running)
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
  operation: 'prompt' | 'createObject' | 'updateObject' | 'deleteObjects';
  input: string;
  output: string | null;
  status: InteractionStatus;
  ai: boolean;
  modifiedObjectIds: string[];
  toolCalls: ToolCall[];
  /** Media URLs attached by the user (uploaded images, documents, etc.) */
  attachments?: string[];
}

/**
 * A conversation within a channel — holds interaction history and optional system instruction.
 */
export interface Conversation {
  name?: string;
  systemInstruction?: string;
  createdAt: number;
  createdBy: string;
  interactions: Record<string, Interaction>;
}

/**
 * Summary info for a conversation (returned by openChannel, no full interaction data).
 */
export interface ConversationInfo {
  id: string;
  name: string | null;
  systemInstruction: string | null;
  createdAt: number;
  createdBy: string;
  interactionCount: number;
}

/**
 * A channel container with metadata and conversations.
 */
export interface Channel {
  name?: string;
  createdAt: number;
  createdBy: string;
  createdByName?: string;
  /** URL of the installed extension, if this channel was created via installExtension. */
  extensionUrl?: string;
  /** ID of the installed extension (user_extensions.extension_id). */
  extensionId?: string;
  /** Extension manifest snapshot, set when an extension is wired to this channel. */
  manifest?: ExtensionManifest;
  conversations: Record<string, Conversation>;
}


/**
 * Channel info for listing - summary without full interaction history.
 */
export interface ChannelInfo {
  id: string;
  name: string | null;
  createdAt: number;
  createdBy: string;
  createdByName: string | null;
  interactionCount: number;
  /** URL of the installed extension, or null if this is a plain channel. */
  extensionUrl: string | null;
  /** ID of the installed extension, or null if this is a plain channel. */
  extensionId: string | null;
  /** Extension manifest snapshot, or null if this is a plain channel. */
  manifest: ExtensionManifest | null;
}


// =============================================================================
// Space Info & User Types
// =============================================================================

export type RoolUserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type LinkAccess = 'none' | 'viewer' | 'editor';

export interface RoolSpaceInfo {
  id: string;
  name: string;
  role: RoolUserRole;
  ownerId: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  linkAccess: LinkAccess;
  memberCount: number;
}

export interface UserResult {
  id: string;
  email: string;
  name: string | null;
  photoUrl: string | null;
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
}

// =============================================================================
// Media Types
// =============================================================================

export interface MediaInfo {
  url: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/**
 * Response from fetchMedia, similar to fetch() Response.
 * Headers are available immediately; call blob() to get the body.
 */
export interface MediaResponse {
  /** MIME type from Content-Type header */
  contentType: string;
  /** Size in bytes from Content-Length header, or null if not available */
  size: number | null;
  /** Get the response body as a Blob */
  blob(): Promise<Blob>;
}

// =============================================================================
// Extension Publishing Types
// =============================================================================

/**
 * Options for uploading an extension bundle.
 */
export interface UploadExtensionOptions {
  /** Zip bundle containing the extension files (must include index.html and manifest.json at root) */
  bundle: File | Blob;
}

/**
 * Extension manifest from manifest.json.
 */
export interface ExtensionManifest {
  /** Extension identifier (lowercase, alphanumeric, hyphens, underscores) */
  id: string;
  /** Display name */
  name: string;
  /** Optional icon path (relative to extension URL) */
  icon?: string;
  /** Collection access declarations */
  collections: Record<string, unknown>;
  /** Optional extension description */
  description?: string;
  /** Optional system instruction for the AI agent */
  systemInstruction?: string | null;
}

/**
 * Options for searching published extensions.
 */
export interface FindExtensionsOptions {
  /** Natural language search query for semantic extension discovery. Omit to browse all. */
  query?: string;
  /** Maximum number of results (default: 20, max: 100) */
  limit?: number;
}

/**
 * A user extension in your personal library.
 * Returned by listExtensions(), getExtensionInfo(), and uploadExtension().
 */
export interface ExtensionInfo {
  /** Extension identifier (URL-safe) */
  extensionId: string;
  /** Extension manifest from manifest.json */
  manifest: ExtensionManifest;
  /** URL where the extension is served */
  url: string;
  /** Bundle size in bytes */
  sizeBytes: number;
  /** Whether this extension is published to the public marketplace */
  published: boolean;
  /** If installed from a marketplace listing, the source extension ID. Null if user-authored. */
  marketplaceExtensionId: string | null;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * A publicly listed extension in the marketplace.
 * Returned by findExtensions().
 */
export interface PublishedExtensionInfo {
  /** Extension identifier (URL-safe) */
  extensionId: string;
  /** Extension manifest from manifest.json */
  manifest: ExtensionManifest;
  /** URL where the extension is served */
  url: string;
  /** Bundle size in bytes */
  sizeBytes: number;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

// =============================================================================
// AI / Prompt Types
// =============================================================================

/**
 * Effort level for AI operations.
 * - 'QUICK': Fast responses, read-only (no object mutations)
 * - 'STANDARD': Default behavior with full capabilities
 * - 'REASONING': Extended reasoning for complex tasks
 * - 'RESEARCH': Pre-analysis and context gathering (reserved for future use)
 */
export type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';

export interface PromptOptions {
  objectIds?: string[];
  responseSchema?: Record<string, unknown>;
  /** Effort level for the AI operation. Defaults to 'STANDARD'. */
  effort?: PromptEffort;
  /** Parent interaction in the conversation tree. Omit to auto-continue from the active leaf. Pass null to start a new root-level branch. */
  parentInteractionId?: string | null;
  /** If true, the prompt won't be recorded in interaction history. Useful for transient operations like tab completion. */
  ephemeral?: boolean;
  /** If true, mutation tools (create, update, delete) are disabled. Defaults to false. */
  readOnly?: boolean;
  /**
   * User-attached files to upload and make visible to the AI.
   * Accepts the same types as `uploadMedia()`: File, Blob, or `{ data, contentType }` for base64.
   * Files are uploaded to the media store; the resulting URLs are sent to the server
   * and stored on the interaction's `attachments` field.
   *
   * Supported file types:
   * - **Images** (JPEG, PNG, GIF, WebP, SVG) — viewed natively by the AI
   * - **PDFs** — viewed natively by the AI
   * - **Text files** (TXT, Markdown, CSV, JSON, XML, HTML) — read as text
   * - **DOCX** — text extracted and read by the AI
   */
  attachments?: Array<File | Blob | { data: string; contentType: string }>;
}

export interface FindObjectsOptions {
  /** Exact-match field filter (e.g. `{ type: 'article' }`). No operators or placeholders — values must match literally. When combined with `prompt`, constrains which objects the AI can see. */
  where?: Record<string, unknown>;
  /** Filter by collection name. Only returns objects whose shape matches the named collection. */
  collection?: string;
  /** Natural language query. Triggers AI evaluation (uses credits). When combined with `where`/`objectIds`, the AI only sees the pre-filtered set. */
  prompt?: string;
  /** Maximum number of results. Only applies to structured filtering (no `prompt`); the AI controls its own result size. */
  limit?: number;
  /** Scope search to specific object IDs. Constrains the candidate set in both structured and AI queries. */
  objectIds?: string[];
  /** Sort order by modifiedAt. Default: 'desc' (most recent first). Only applies to structured filtering (no `prompt`). */
  order?: 'asc' | 'desc';
  /** If true, the query won't be recorded in interaction history. Useful for responsive search. */
  ephemeral?: boolean;
}

export interface CreateObjectOptions {
  /** Object data fields. Must include `type` naming an existing collection. Include `id` for custom ID. Use `{{placeholder}}` for AI-generated content. Fields prefixed with `_` are hidden from AI. */
  data: Record<string, unknown>;
  /** If true, the operation won't be recorded in interaction history. */
  ephemeral?: boolean;
}

export interface UpdateObjectOptions {
  /** Fields to add or update. Pass null/undefined to delete a field. Use `{{placeholder}}` for AI-generated content. Setting a new `type` retypes the object — the merged result must conform to the new collection. Fields prefixed with `_` are hidden from AI. */
  data?: Record<string, unknown>;
  /** Natural language instruction for AI to modify content. */
  prompt?: string;
  /** If true, the operation won't be recorded in interaction history. */
  ephemeral?: boolean;
}

// =============================================================================
// Subscription / Connection Types
// =============================================================================

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export type RoolEventSource = 'user' | 'agent';

// -----------------------------------------------------------------------------
// Client-level events (space lifecycle)
// -----------------------------------------------------------------------------

export type ClientEventType = 'connected' | 'space_created' | 'space_deleted' | 'space_renamed' | 'space_access_changed' | 'user_storage_changed' | 'channel_created' | 'channel_renamed' | 'channel_deleted';

interface ClientEventBase {
  timestamp: number;
}

export interface ConnectedClientEvent extends ClientEventBase {
  type: 'connected';
  serverVersion: string;
}

export interface SpaceCreatedClientEvent extends ClientEventBase {
  type: 'space_created';
  spaceId: string;
  name: string;
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
  ownerId: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  role: string;
  linkAccess: string;
  memberCount: number;
}

export interface UserStorageChangedClientEvent extends ClientEventBase {
  type: 'user_storage_changed';
  key: string;
  value: unknown;
}

export interface ChannelCreatedClientEvent extends ClientEventBase {
  type: 'channel_created';
  spaceId: string;
  channelId: string;
  name?: string;
  channelCreatedAt?: number;
  channelCreatedBy?: string;
  channelCreatedByName?: string;
  channelExtensionUrl?: string | null;
  channelExtensionId?: string | null;
  channelManifest?: ExtensionManifest | null;
}

export interface ChannelRenamedClientEvent extends ClientEventBase {
  type: 'channel_renamed';
  spaceId: string;
  channelId: string;
  name: string;
}

export interface ChannelDeletedClientEvent extends ClientEventBase {
  type: 'channel_deleted';
  spaceId: string;
  channelId: string;
}

export type ClientEvent =
  | ConnectedClientEvent
  | SpaceCreatedClientEvent
  | SpaceDeletedClientEvent
  | SpaceRenamedClientEvent
  | SpaceAccessChangedClientEvent
  | UserStorageChangedClientEvent
  | ChannelCreatedClientEvent
  | ChannelRenamedClientEvent
  | ChannelDeletedClientEvent;

// -----------------------------------------------------------------------------
// Channel-level subscription events (wire protocol)
// -----------------------------------------------------------------------------

export type ChannelEventType =
  | 'connected'
  | 'space_changed'
  | 'object_created'
  | 'object_updated'
  | 'object_deleted'
  | 'schema_updated'
  | 'metadata_updated'
  | 'channel_updated'
  | 'channel_deleted'
  | 'conversation_updated';


export interface ChannelEvent {
  type: ChannelEventType;
  spaceId: string;
  timestamp: number;
  source: RoolEventSource;
  // Object events
  objectId?: string;
  object?: RoolObject;
  /** Object stat (audit info) — present on object_created and object_updated events */
  objectStat?: RoolObjectStat;
  // Schema events
  schema?: SpaceSchema;
  // Metadata events
  metadata?: Record<string, unknown>;
  // Channel events
  channelId?: string;
  channel?: Channel;
  // Conversation events
  conversationId?: string;
  conversation?: Conversation;
  // Connected events
  serverVersion?: number;
}


// =============================================================================
// Client Configuration
// =============================================================================

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
  /** Logout and clear session */
  logout: () => void;
  /** Clean up resources (e.g. stop timers) */
  destroy?: () => void;
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
  /** Override media endpoint (default: `{apiUrl}/media`) */
  mediaUrl?: string;
  /** Override auth endpoint (derived from `apiUrl` by stripping `api.` prefix) */
  authUrl?: string;
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

// =============================================================================
// Event Types for EventEmitter
// =============================================================================

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
  /** Emitted when a space is added to the user's list (created or access granted) */
  spaceAdded: (space: RoolSpaceInfo) => void;
  /** Emitted when a space is removed from the user's list (deleted or access revoked) */
  spaceRemoved: (spaceId: string) => void;
  /** Emitted when a space is renamed (by any client) */
  spaceRenamed: (spaceId: string, newName: string) => void;
  /** Emitted when a channel is created in a space */
  channelCreated: (spaceId: string, channel: ChannelInfo) => void;
  /** Emitted when a channel's metadata changes (name, extension, manifest) */
  channelUpdated: (spaceId: string, channel: ChannelInfo) => void;
  /** Emitted when a channel is deleted */
  channelDeleted: (spaceId: string, channelId: string) => void;
  /** Emitted when user storage changes (local or remote) */
  userStorageChanged: (event: UserStorageChangedEvent) => void;
  /** Emitted when SSE connection state changes */
  connectionStateChanged: (state: ConnectionState) => void;
  /** Emitted on errors */
  error: (error: Error, context?: string) => void;
  /** Index signature for EventEmitter compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
}

/**
 * Space-level events emitted by RoolSpace.
 * Includes channel lifecycle events derived from the space SSE subscription.
 */
export interface RoolSpaceEvents {
  /** A new channel was created in this space */
  channelCreated: (channel: ChannelInfo) => void;
  /** A channel's metadata changed (name, extension, manifest) */
  channelUpdated: (channel: ChannelInfo) => void;
  /** A channel was deleted from this space */
  channelDeleted: (channelId: string) => void;
  /** SSE connection state changed */
  connectionStateChanged: (state: ConnectionState) => void;
  /** Index signature for EventEmitter compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
}

// =============================================================================
// Space Event Types (for RoolChannel EventEmitter)
// =============================================================================

/**
 * Source of a space change event.
 * - 'local_user': This client made the change
 * - 'remote_user': Another user/client made the change
 * - 'remote_agent': AI agent made the change
 * - 'system': Resync after error
 */
export type ChangeSource = 'local_user' | 'remote_user' | 'remote_agent' | 'system';

export interface ObjectCreatedEvent {
  objectId: string;
  object: RoolObject;
  source: ChangeSource;
}

export interface ObjectUpdatedEvent {
  objectId: string;
  object: RoolObject;
  source: ChangeSource;
}

export interface ObjectDeletedEvent {
  objectId: string;
  source: ChangeSource;
}

export interface MetadataUpdatedEvent {
  metadata: Record<string, unknown>;
  source: ChangeSource;
}

export interface SchemaUpdatedEvent {
  schema: SpaceSchema;
  source: ChangeSource;
}

export interface ResetEvent {
  source: ChangeSource;
}


export interface ChannelUpdatedEvent {
  channelId: string;
  source: ChangeSource;
}

export interface ConversationUpdatedEvent {
  conversationId: string;
  channelId: string;
  source: ChangeSource;
}

/**
 * Channel-level events (content changes within a specific channel).
 *
 * Semantic events describe what changed:
 * - `objectCreated`, `objectUpdated`, `objectDeleted`: Object changes
 * - `metadataUpdated`: Space metadata changes
 * - `channelUpdated`: Channel metadata changed (name, extensionUrl)
 * - `conversationUpdated`: Conversation interaction history changed
 * - `reset`: Full state replacement (undo/redo, resync)
 *
 * Events fire for both local changes and remote changes (from other users or AI agents).
 * Use the `source` field to determine the origin of the change.
 */
export interface ChannelEvents {
  /** A new object was created */
  objectCreated: (event: ObjectCreatedEvent) => void;
  /** An existing object was updated */
  objectUpdated: (event: ObjectUpdatedEvent) => void;
  /** An object was deleted */
  objectDeleted: (event: ObjectDeletedEvent) => void;
  /** Space metadata was updated */
  metadataUpdated: (event: MetadataUpdatedEvent) => void;
  /** Collection schema was updated */
  schemaUpdated: (event: SchemaUpdatedEvent) => void;
  /** Channel metadata was updated (name, extensionUrl) */
  channelUpdated: (event: ChannelUpdatedEvent) => void;
  /** Conversation interaction history was updated */
  conversationUpdated: (event: ConversationUpdatedEvent) => void;
  /** Full state replacement (undo/redo, resync) */
  reset: (event: ResetEvent) => void;
  /** Emitted when a sync error occurs and the channel resyncs from server */
  syncError: (error: Error) => void;
  /** Index signature for EventEmitter compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => void;
}


// =============================================================================
// Auth Types
// =============================================================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface AuthUser {
  email: string | null;
  name: string | null;
}
