// =============================================================================
// Rool Client Types
// Generic types for space-based applications using the Rool server API
// =============================================================================

/**
 * Object data - the user content portion of an object.
 * Always contains `id` (the object's unique identifier).
 * Free-form JSON with any additional fields. While `type` is a common convention
 * (e.g., 'article', 'note', 'task'), it's not required by the framework.
 * Consumer applications define their own object schemas.
 */
export interface RoolObject {
  id: string;
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
 * Internal storage structure for a space object.
 * - links: Outbound relationships { relation: [targetId1, targetId2, ...] }
 * - data: The user content (RoolObject). Fields prefixed with _ are hidden from AI.
 */
export interface RoolObjectEntry {
  links: Record<string, string[]>;
  data: RoolObject;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
}

/**
 * A tool call record - captures what the agent did during an interaction.
 */
export interface ToolCall {
  name: string;      // Tool name ("create_object", "link", etc.)
  input: unknown;    // Original args (verbatim)
  result: string;    // Stringified, truncated result
}

/**
 * An interaction entry - combines request and response in a single record.
 */
export interface Interaction {
  id: string;
  timestamp: number;
  userId: string;
  userName?: string | null;  // Display name at time of interaction
  operation: 'prompt' | 'createObject' | 'updateObject' | 'link' | 'unlink' | 'deleteObjects';
  input: string;
  output: string | null;
  ai: boolean;
  modifiedObjectIds: string[];
  toolCalls: ToolCall[];
}

/**
 * A conversation container with metadata and interaction history.
 */
export interface Conversation {
  name?: string;
  createdAt: number;
  createdBy: string;
  createdByName?: string;
  systemInstruction?: string;
  interactions: Interaction[];
}

/**
 * Conversation info for listing - summary without full interaction history.
 */
export interface ConversationInfo {
  id: string;
  name: string | null;
  createdAt: number;
  createdBy: string;
  createdByName: string | null;
  interactionCount: number;
}

/**
 * Space structure - objects keyed by ID.
 * meta is space-level metadata, preserved but hidden from AI operations.
 * conversations contains conversation data keyed by conversationId.
 */
export interface RoolSpaceData {
  /** Monotonically increasing version for sync consistency detection */
  version: number;
  objects: Record<string, RoolObjectEntry>;
  meta: Record<string, unknown>;
  /** Conversations keyed by conversationId */
  conversations?: Record<string, Conversation>;
}

// =============================================================================
// JSON Patch (RFC 6902)
// =============================================================================

export type JSONPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; path: string; from: string }
  | { op: 'copy'; path: string; from: string }
  | { op: 'test'; path: string; value: unknown };

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
}

export interface UserResult {
  id: string;
  email: string;
  name: string | null;
}

export interface SpaceMember {
  id: string;
  email: string;
  role: RoolUserRole;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
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
// App Publishing Types
// =============================================================================

/**
 * Options for publishing an app.
 */
export interface PublishAppOptions {
  /** Display name for the app */
  name: string;
  /** Zip bundle containing the app files (must include index.html at root) */
  bundle: File | Blob;
  /** Enable SPA routing (404s serve index.html). Defaults to true. */
  spa?: boolean;
}

/**
 * Info about a published app.
 */
export interface PublishedAppInfo {
  /** App identifier (URL-safe) */
  appId: string;
  /** Display name */
  name: string;
  /** Public URL where the app is accessible */
  url: string;
  /** Whether SPA routing is enabled */
  spa: boolean;
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
  /** If true, the prompt won't be recorded in conversation history. Useful for transient operations like tab completion. */
  ephemeral?: boolean;
  /** If true, mutation tools (create, update, link, unlink) are disabled. Defaults to false. */
  readOnly?: boolean;
}

export interface FindObjectsOptions {
  where?: Record<string, unknown>;
  prompt?: string;
  limit?: number;
  objectIds?: string[];
  /** Sort order by modifiedAt. Default: 'desc' (most recent first) */
  order?: 'asc' | 'desc';
  /** If true, the query won't be recorded in conversation history. Useful for responsive search. */
  ephemeral?: boolean;
}

export interface CreateObjectOptions {
  /** Object data fields. Include `id` for custom ID. Use `{{placeholder}}` for AI-generated content. Fields prefixed with `_` are hidden from AI. */
  data: Record<string, unknown>;
  /** If true, the operation won't be recorded in conversation history. */
  ephemeral?: boolean;
}

export interface UpdateObjectOptions {
  /** Fields to add or update. Pass null/undefined to delete a field. Use `{{placeholder}}` for AI-generated content. Fields prefixed with `_` are hidden from AI. */
  data?: Record<string, unknown>;
  /** Natural language instruction for AI to modify content. */
  prompt?: string;
  /** If true, the operation won't be recorded in conversation history. */
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

export type ClientEventType = 'connected' | 'space_created' | 'space_deleted' | 'space_renamed' | 'space_access_changed' | 'user_storage_changed';

export interface ClientEvent {
  type: ClientEventType;
  spaceId?: string;  // Present on space events
  timestamp: number;
  name?: string;  // Present on space_created, space_renamed, space_access_changed events
  ownerId?: string;  // Present on space_created, space_access_changed events
  size?: number;  // Present on space_created, space_access_changed events
  createdAt?: string;  // Present on space_created, space_access_changed events
  updatedAt?: string;  // Present on space_created, space_access_changed events
  role?: string;  // Present on space_created, space_access_changed events ('none' = access revoked)
  linkAccess?: string;  // Present on space_access_changed events
  key?: string;   // Present on user_storage_changed events
  value?: unknown; // Present on user_storage_changed events
  serverVersion?: string;  // Present on connected events
}

// -----------------------------------------------------------------------------
// Space-level events (content changes)
// -----------------------------------------------------------------------------

export type SpaceEventType = 'connected' | 'space_patched' | 'space_changed';

export interface SpaceEvent {
  type: SpaceEventType;
  spaceId: string;
  timestamp: number;
  patch?: JSONPatchOp[];  // Present on space_patched events
  source: RoolEventSource;
  conversationId?: string;  // Present on space events
  serverVersion?: number;  // Present on connected events
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
  /** Get current access token */
  getToken: () => Promise<string | undefined>;
  /** Get auth identity from current session (decoded from token) */
  getAuthUser: () => { email: string | null; name: string | null };
  /** Check if currently authenticated (validates token is usable) */
  isAuthenticated: () => Promise<boolean>;
  /** Initiate login with application name */
  login: (appName: string) => Promise<void> | void;
  /** Logout and clear session */
  logout: () => void;
  /** Clean up resources (e.g. stop timers) */
  destroy?: () => void;
  /** Get cached storage data */
  getStorage: () => Record<string, unknown> | null;
  /** Set cached storage data */
  setStorage: (data: Record<string, unknown>) => void;
}

export interface RoolClientConfig {
  /** Base URL of the Rool deployment (default: 'https://api.rool.dev') */
  baseUrl?: string;
  /** Override GraphQL endpoint (default: {baseUrl}/graphql) */
  graphqlUrl?: string;
  /** Override media endpoint (default: {baseUrl}/media) */
  mediaUrl?: string;
  /** Override auth endpoint (default: {baseUrl}/auth) */
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

// =============================================================================
// Space Event Types (for RoolSpace EventEmitter)
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

export interface LinkedEvent {
  sourceId: string;
  relation: string;
  targetId: string;
  source: ChangeSource;
}

export interface UnlinkedEvent {
  sourceId: string;
  relation: string;
  targetId: string;
  source: ChangeSource;
}

export interface MetadataUpdatedEvent {
  metadata: Record<string, unknown>;
  source: ChangeSource;
}

export interface SpaceResetEvent {
  source: ChangeSource;
}

export interface ConversationUpdatedEvent {
  conversationId: string;
  source: ChangeSource;
}

export interface ConversationIdChangedEvent {
  previousConversationId: string;
  newConversationId: string;
}

export interface ConversationsChangedEvent {
  action: 'created' | 'deleted' | 'renamed';
  conversationId: string;
  name?: string;
  source: ChangeSource;
}

/**
 * Space-level events (content changes within a specific space).
 *
 * Semantic events describe what changed:
 * - `objectCreated`, `objectUpdated`, `objectDeleted`: Object changes
 * - `linked`, `unlinked`: Link changes
 * - `metadataUpdated`: Space metadata changes
 * - `conversationUpdated`: Conversation interaction history changed
 * - `conversationsChanged`: Conversation list changed (created, deleted, renamed)
 * - `conversationIdChanged`: ConversationId was changed on the space
 * - `reset`: Full state replacement (undo/redo, resync)
 *
 * Events fire for both local changes and remote changes (from other users or AI agents).
 * Use the `source` field to determine the origin of the change.
 */
export interface SpaceEvents {
  /** A new object was created */
  objectCreated: (event: ObjectCreatedEvent) => void;
  /** An existing object was updated */
  objectUpdated: (event: ObjectUpdatedEvent) => void;
  /** An object was deleted */
  objectDeleted: (event: ObjectDeletedEvent) => void;
  /** A link was added between objects */
  linked: (event: LinkedEvent) => void;
  /** A link was removed between objects */
  unlinked: (event: UnlinkedEvent) => void;
  /** Space metadata was updated */
  metadataUpdated: (event: MetadataUpdatedEvent) => void;
  /** Conversation interaction history was updated */
  conversationUpdated: (event: ConversationUpdatedEvent) => void;
  /** Conversation list changed (created, deleted, or renamed) */
  conversationsChanged: (event: ConversationsChangedEvent) => void;
  /** Full state replacement (undo/redo, resync) */
  reset: (event: SpaceResetEvent) => void;
  /** Emitted when conversationId is changed */
  conversationIdChanged: (event: ConversationIdChangedEvent) => void;
  /** Emitted when a sync error occurs and the space resyncs from server */
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
