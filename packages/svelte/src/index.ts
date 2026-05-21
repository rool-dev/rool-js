// Main export
export { createRool, generateId } from './rool.svelte.js';

// Location helpers — re-exported from the SDK for convenience
export { loc, parseLocation, normalizeLocation, isLocation, generateBasename } from '@rool-dev/sdk';
export type { ParsedLocation } from '@rool-dev/sdk';

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
} from '@rool-dev/sdk';
