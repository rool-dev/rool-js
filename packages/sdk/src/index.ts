// Main client
export { RoolClient } from './client.js';

// Space operation helpers
export { ConversationHandle, generateEntityId } from './space-session.js';

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

// Invite redemption errors
export { InviteError } from './rest.js';
export type { InviteErrorCode } from './rest.js';

// Event emitter (for extending)
export { EventEmitter } from './event-emitter.js';

// Native PKCE auth provider (for JS app shells: Capacitor, Cordova, ...)
export { NativePkceAuthProvider } from './auth-native.js';
export type { NativePkceAuthConfig, NativeAuthFlowProvider } from './auth-native.js';

export { roolSdkVersion } from './client-info.js';

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
  SpaceEvent,
  SpaceEventType,
  RoolEventSource,

  // User types
  SpaceMember,
  RoolUserRole,
  InviteRole,
  SpaceInvite,
  SpaceInviteCreated,
  InviteEmailStatus,
  InvitePreview,
  InviteRedeemResult,

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
  SpaceContentEvents,
  ConversationUpdatedEvent,
  ResetEvent,

  // Conversation types
  Conversation,
  ConversationMeta,
  Interaction,
  InteractionStatus,
  ToolCall,
  RunningToolCall,
  FinishedToolCall,

  // Config types
  RoolClientConfig,
  RoolClientEvents,
  RoolSpaceEvents,
  AuthTokens,
  AuthProvider,
  PasswordSignInResult,
  RoolClientIdentity,
  ServerInfo,
  ClientCompatibility,
} from './types.js';
