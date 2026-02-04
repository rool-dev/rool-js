// =============================================================================
// Rool Client
// Generic TypeScript client library for the Rool server API
// =============================================================================

// Main client
export { RoolClient } from './client.js';

// Space class
export { RoolSpace, generateEntityId } from './space.js';

// Event emitter (for extending)
export { EventEmitter } from './event-emitter.js';

// JSON-LD types
export type { JsonLdDocument, JsonLdNode } from './jsonld.js';

// Types
export type {
  // Core types
  RoolObject,
  RoolObjectEntry,
  RoolObjectStat,
  RoolSpaceData,
  RoolSpaceInfo,
  JSONPatchOp,

  // Subscription event types (wire protocol)
  ClientEvent,
  ClientEventType,
  SpaceEvent,
  SpaceEventType,
  RoolEventSource,

  // User types
  SpaceMember,
  RoolUserRole,
  UserResult,
  CurrentUser,
  AuthUser,

  // Media types
  MediaInfo,
  MediaResponse,

  // App publishing types
  PublishAppOptions,
  PublishedAppInfo,

  // AI types
  PromptOptions,
  FindObjectsOptions,

  // Connection types
  ConnectionState,

  // Event types (emitter)
  SpaceEvents,
  ObjectCreatedEvent,
  ObjectUpdatedEvent,
  ObjectDeletedEvent,
  LinkedEvent,
  UnlinkedEvent,
  MetadataUpdatedEvent,
  ConversationUpdatedEvent,
  ConversationsChangedEvent,
  SpaceResetEvent,

  // Conversation types
  Conversation,
  ConversationInfo,
  Interaction,

  // Config types
  RoolClientConfig,
  RoolClientEvents,
  AuthTokens,
  AuthProvider,
} from './types.js';
