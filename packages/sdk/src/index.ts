// =============================================================================
// Rool Client
// Generic TypeScript client library for the Rool server API
// =============================================================================

// Main client
export { RoolClient } from './client.js';

// Channel class
export { RoolChannel, ConversationHandle, generateEntityId } from './channel.js';

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

  // Extension publishing types
  PublishExtensionOptions,
  PublishedExtensionInfo,
  ExtensionManifest,
  FindExtensionsOptions,

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
  ChangeSource,
  ChannelEvents,
  ObjectCreatedEvent,
  ObjectUpdatedEvent,
  ObjectDeletedEvent,
  MetadataUpdatedEvent,
  SchemaUpdatedEvent,
  ChannelUpdatedEvent,
  ConversationUpdatedEvent,
  ResetEvent,

  // Channel types
  Channel,
  ChannelInfo,
  Conversation,
  ConversationInfo,
  Interaction,
  InteractionStatus,

  // Config types
  RoolClientConfig,
  RoolClientEvents,
  AuthTokens,
  AuthProvider,
} from './types.js';
