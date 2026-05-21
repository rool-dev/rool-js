/**
 * Lightweight types for extension-side code.
 *
 * These mirror the SDK types but are defined locally so that
 * @rool-dev/extension has zero runtime dependencies for extensions.
 */

// -- Objects ------------------------------------------------------------------

/**
 * An object in a space. Identity lives in the envelope; body holds the
 * user-defined fields and never contains `id` or `type`. References between
 * objects are body fields whose values are location strings.
 */
export interface RoolObject {
  /** Canonical location: `/space/<collection>/<basename>.json`. */
  location: string;
  /** Collection name (parent directory of the location). */
  collection: string;
  /** Basename (filename of the location without `.json`). */
  basename: string;
  /** User-defined fields. Never contains identity. */
  body: Record<string, unknown>;
}

export interface RoolObjectStat {
  location: string;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInChannel: string;
  modifiedInConversation: string | null;
  modifiedInInteraction: string | null;
}

// -- Schema -------------------------------------------------------------------

export type FieldType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'array'; inner?: FieldType }
  | { kind: 'maybe'; inner: FieldType }
  | { kind: 'enum'; values: string[] }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'ref' };

export interface FieldDef {
  name: string;
  type: FieldType;
}

export interface CollectionDef {
  fields: FieldDef[];
}

export type SpaceSchema = Record<string, CollectionDef>;

// -- Interactions -------------------------------------------------------------

export interface ToolCall {
  name: string;
  input: unknown;
  result?: string;
}

export type InteractionStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface Interaction {
  id: string;
  /** Parent interaction in the conversation tree. null = root message. */
  parentId: string | null;
  timestamp: number;
  userId: string;
  userName?: string | null;
  operation: 'prompt' | 'createObject' | 'updateObject' | 'moveObject' | 'deleteObjects';
  input: string;
  output: string | null;
  status: InteractionStatus;
  ai: boolean;
  modifiedObjectLocations: string[];
  toolCalls: ToolCall[];
  attachments?: string[];
}

// -- Options ------------------------------------------------------------------

export type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';

export interface PromptOptions {
  /** Focus the AI on specific objects, by location. */
  locations?: string[];
  responseSchema?: Record<string, unknown>;
  effort?: PromptEffort;
  ephemeral?: boolean;
  readOnly?: boolean;
  /** Parent interaction in the conversation tree. Omit to auto-continue from the active leaf. */
  parentInteractionId?: string | null;
  // Note: attachments are not supported over the bridge (no File/Blob transfer)
}

export interface FindObjectsOptions {
  where?: Record<string, unknown>;
  collection?: string;
  prompt?: string;
  limit?: number;
  /** Scope search to specific object locations. */
  locations?: string[];
  order?: 'asc' | 'desc';
  ephemeral?: boolean;
}

export interface CreateObjectOptions {
  /** Specific basename to use. If omitted, the SDK generates a random one. */
  basename?: string;
  ephemeral?: boolean;
  parentInteractionId?: string | null;
}

export interface UpdateObjectOptions {
  data?: Record<string, unknown>;
  prompt?: string;
  ephemeral?: boolean;
  parentInteractionId?: string | null;
}

export interface MoveObjectOptions {
  /** Replace the body atomically as part of the move. If omitted, body is preserved. */
  body?: Record<string, unknown>;
  ephemeral?: boolean;
  parentInteractionId?: string | null;
}

// -- Events -------------------------------------------------------------------

export type ChangeSource = 'local_user' | 'remote_user' | 'remote_agent' | 'system';

export type RoolUserRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type LinkAccess = 'none' | 'viewer' | 'editor';

export interface ConversationInfo {
  id: string;
  name: string | null;
  systemInstruction: string | null;
  createdAt: number;
  createdBy: string;
  interactionCount: number;
}

export interface ObjectCreatedEvent {
  location: string;
  object: RoolObject;
  source: ChangeSource;
}

export interface ObjectUpdatedEvent {
  location: string;
  object: RoolObject;
  source: ChangeSource;
}

export interface ObjectDeletedEvent {
  location: string;
  source: ChangeSource;
}

export interface ObjectMovedEvent {
  from: string;
  to: string;
  object: RoolObject;
  source: ChangeSource;
}

export interface ChannelEvents {
  objectCreated: ObjectCreatedEvent;
  objectUpdated: ObjectUpdatedEvent;
  objectDeleted: ObjectDeletedEvent;
  objectMoved: ObjectMovedEvent;
  metadataUpdated: { metadata: Record<string, unknown>; source: ChangeSource };
  schemaUpdated: { schema: SpaceSchema; source: ChangeSource };
  channelUpdated: { channelId: string; source: ChangeSource };
  conversationUpdated: { conversationId: string; channelId: string; source: ChangeSource };
  reset: { source: ChangeSource };
  syncError: Error;
}
