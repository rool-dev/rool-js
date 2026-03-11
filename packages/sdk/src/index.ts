// =============================================================================
// Rool Client
// Generic TypeScript client library for the Rool server API
// =============================================================================

// Main client
export { RoolClient } from './client.js';

// Channel class
export { RoolChannel, generateEntityId } from './channel.js';

// Space class
export { RoolSpace } from './space.js';

// Event emitter (for extending)
export { EventEmitter } from './event-emitter.js';

// Logger
export type { Logger } from './logger.js';

// Types
export type {
  // Core types
  RoolObject,
  RoolObjectStat,
  RoolSpaceInfo,

  // Subscription event types (wire protocol)
  ClientEvent,
  ClientEventType,
  ChannelEvent,
  ChannelEventType,
  RoolEventSource,

  // User types
  SpaceMember,
  RoolUserRole,
  LinkAccess,

  UserResult,
  CurrentUser,
  AuthUser,

  // Media types
  MediaInfo,
  MediaResponse,

  // App publishing types
  PublishAppOptions,
  PublishedAppInfo,

  // Schema types
  FieldType,
  FieldDef,
  CollectionDef,
  SpaceSchema,

  // AI types
  PromptOptions,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,

  // Connection types
  ConnectionState,

  // Event types (emitter)
  ChannelEvents,
  ObjectCreatedEvent,
  ObjectUpdatedEvent,
  ObjectDeletedEvent,
  MetadataUpdatedEvent,
  ChannelUpdatedEvent,
  ResetEvent,

  // Channel types
  Channel,
  ChannelInfo,
  Interaction,

  // Config types
  RoolClientConfig,
  RoolClientEvents,
  AuthTokens,
  AuthProvider,
} from './types.js';
