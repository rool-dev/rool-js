/**
 * Lightweight types for app-side code.
 *
 * These mirror the SDK types but are defined locally so that
 * @rool-dev/app has zero runtime dependencies for apps.
 */

// -- Objects ------------------------------------------------------------------

export interface RoolObject {
  id: string;
  [key: string]: unknown;
}

export interface RoolObjectStat {
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
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
  result: string;
}

export interface Interaction {
  id: string;
  timestamp: number;
  userId: string;
  userName?: string | null;
  operation: 'prompt' | 'createObject' | 'updateObject' | 'deleteObjects';
  input: string;
  output: string | null;
  ai: boolean;
  modifiedObjectIds: string[];
  toolCalls: ToolCall[];
  attachments?: string[];
}

// -- Options ------------------------------------------------------------------

export type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';

export interface PromptOptions {
  objectIds?: string[];
  responseSchema?: Record<string, unknown>;
  effort?: PromptEffort;
  ephemeral?: boolean;
  readOnly?: boolean;
  // Note: attachments are not supported over the bridge (no File/Blob transfer)
}

export interface FindObjectsOptions {
  where?: Record<string, unknown>;
  collection?: string;
  prompt?: string;
  limit?: number;
  objectIds?: string[];
  order?: 'asc' | 'desc';
  ephemeral?: boolean;
}

export interface CreateObjectOptions {
  data: Record<string, unknown>;
  ephemeral?: boolean;
}

export interface UpdateObjectOptions {
  data?: Record<string, unknown>;
  prompt?: string;
  ephemeral?: boolean;
}

// -- Events -------------------------------------------------------------------

export type ChangeSource = 'local_user' | 'remote_user' | 'remote_agent' | 'system';

export type RoolUserRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type LinkAccess = 'none' | 'viewer' | 'editor';

export interface AppChannelEvents {
  objectCreated: { objectId: string; object: RoolObject; source: ChangeSource };
  objectUpdated: { objectId: string; object: RoolObject; source: ChangeSource };
  objectDeleted: { objectId: string; source: ChangeSource };
  metadataUpdated: { metadata: Record<string, unknown>; source: ChangeSource };
  schemaUpdated: { schema: SpaceSchema; source: ChangeSource };
  channelUpdated: { channelId: string; source: ChangeSource };
  reset: { source: ChangeSource };
  syncError: Error;
}
