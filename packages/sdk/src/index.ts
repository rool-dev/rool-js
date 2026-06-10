// Main client
export { RoolClient } from './client.js';

// Channel class
export { RoolChannel, ConversationHandle, generateEntityId } from './channel.js';

// Space class
export { RoolSpace } from './space.js';

// Machine paths
export { isObjectPath, machinePath, machineUri } from './path.js';

// WebDAV client
export { RoolWebDAV, WebDAVError } from './webdav.js';
export type {
  SpaceFileStorageUsage,
  WebDAVActiveLock,
  WebDAVDepth,
  WebDAVLockDepth,
  WebDAVLockResult,
  WebDAVMultiStatus,
  WebDAVSyncCollectionResult,
  WebDAVSyncLevel,
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
  GetObjectsResult,
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


  // Schema types
  FieldType,
  FieldDef,
  CollectionDef,
  CollectionOptions,
  SpaceSchema,

  // AI types
  PromptOptions,
  PromptAttachment,
  PromptEffort,
  UpdateObjectOptions,
  MoveObjectOptions,

  // Connection types
  ConnectionState,

  // Event types (emitter)
  ChangeSource,
  ChannelEvents,
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
  AuthTokens,
  AuthProvider,
} from './types.js';
