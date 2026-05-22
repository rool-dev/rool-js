// Main client
export { RoolClient } from './client.js';

// Channel class
export { RoolChannel, ConversationHandle, generateEntityId } from './channel.js';

// Space class
export { RoolSpace } from './space.js';

// Location helpers
export { loc, parseLocation, normalizeLocation, isLocation, generateBasename } from './locations.js';
export type { ParsedLocation } from './locations.js';

// WebDAV client
export { ROOL_DRIVE_REF_PREFIX, RoolWebDAV, WebDAVError } from './webdav.js';
export type {
  RoolDriveRef,
  SpaceFileStorageUsage,
  WebDAVActiveLock,
  WebDAVDepth,
  WebDAVLockDepth,
  WebDAVLockResult,
  WebDAVMultiStatus,
  WebDAVPathInput,
  WebDAVPropName,
  WebDAVProps,
  WebDAVPropstat,
  WebDAVRequestInit,
  WebDAVResponse,
  WebDAVWriteResult,
} from './webdav.js';

// Space router (shard resolution for space-scoped traffic)
export { SpaceRouter } from './router.js';
export type { RouteInfo } from './router.js';

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

  // Extension types
  UploadExtensionOptions,
  ExtensionInfo,
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
  PromptEffort,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  MoveObjectOptions,

  // Connection types
  ConnectionState,

  // Event types (emitter)
  ChangeSource,
  ChannelEvents,
  ObjectCreatedEvent,
  ObjectUpdatedEvent,
  ObjectDeletedEvent,
  ObjectMovedEvent,
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
  ToolCall,
  RunningToolCall,
  FinishedToolCall,

  // Config types
  RoolClientConfig,
  RoolClientEvents,
  RoolSpaceEvents,
  ProbeRequestEvent,
  OpenExtensionEvent,
  AuthTokens,
  AuthProvider,
} from './types.js';
