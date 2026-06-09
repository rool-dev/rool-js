// Main export
export { createRool, generateId } from './rool.svelte.js';

// Location and machine-resource helpers — re-exported from the SDK for convenience
export {
  loc,
  parseLocation,
  normalizeLocation,
  isLocation,
  generateBasename,
  resolveMachineResource,
} from '@rool-dev/sdk';
export type { ParsedLocation, MachineResource } from '@rool-dev/sdk';

// Reactive wrappers
export { wrapChannel } from './channel.svelte.js';
export { wrapSpace } from './space.svelte.js';

// Types
export type { Rool } from './rool.svelte.js';
export type { ReactiveChannel, ReactiveConversationHandle, ReactiveObject, ReactiveWatch, ReactiveChannelList, WatchOptions } from './channel.svelte.js';
export type { ReactiveSpace } from './space.svelte.js';

// Re-export SDK types for convenience
export type {
  RoolClientConfig,
  RoolChannel,
  RoolSpace,
  RoolSpaceInfo,
  RoolObject,
  RoolObjectStat,
  RoolUserRole,
  ConnectionState,
  ChannelInfo,
  Conversation,
  ConversationInfo,
  CurrentUser,
  Interaction,
  FindObjectsOptions,
  PromptOptions,
  PromptAttachment,
  CreateObjectOptions,
  UpdateObjectOptions,
  MoveObjectOptions,
  FieldType,
  FieldDef,
  CollectionDef,
  SpaceSchema,
  SpaceMember,
  UserResult,
  RoolClient,
  ExtensionInfo,
  PublishedExtensionInfo,
  UploadExtensionOptions,
  ExtensionManifest,
  FindExtensionsOptions,
  RoolSpaceEvents,
  ProbeRequestEvent,
  OpenExtensionEvent,
  SpaceFileStorageUsage,
} from '@rool-dev/sdk';
