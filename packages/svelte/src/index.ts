// Main export
export { createRool, generateId } from './rool.svelte.js';

// Machine path helpers — re-exported from the SDK for convenience
export { machinePath, machineUri } from '@rool-dev/sdk';

// Reactive wrappers
export { wrapChannel } from './channel.svelte.js';
export { wrapSpace } from './space.svelte.js';
export { ReactiveFileTree } from './file-tree.svelte.js';

// Types
export type { Rool } from './rool.svelte.js';
export type { ReactiveChannel, ReactiveConversationHandle, ReactiveObject, ReactiveWatch, ReactiveChannelList, WatchOptions } from './channel.svelte.js';
export type { ReactiveSpace } from './space.svelte.js';
export type { ReactiveFileNode, ReactiveFilePath, ReactiveFileRoot, ReactiveFileTreeEvent, ReactiveFileTreeSyncResult } from './file-tree.svelte.js';

// Re-export SDK types for convenience
export type {
  RoolClientConfig,
  RoolChannel,
  RoolSpace,
  RoolSpaceInfo,
  RoolObject,
  GetObjectsResult,
  RoolObjectStat,
  RoolUserRole,
  ConnectionState,
  ChannelInfo,
  Conversation,
  ConversationInfo,
  CurrentUser,
  Interaction,
  PromptOptions,
  PromptAttachment,
  UpdateObjectOptions,
  MoveObjectOptions,
  CollectionOptions,
  FieldType,
  FieldDef,
  CollectionDef,
  SpaceSchema,
  SpaceMember,
  UserResult,
  RoolClient,
  RoolSpaceEvents,
  ProbeRequestEvent,
  SpaceFileStorageUsage,
  WebDAVDepth,
  WebDAVSyncLevel,
  WebDAVPropName,
  WebDAVResponse,
  WebDAVProps,
} from '@rool-dev/sdk';
