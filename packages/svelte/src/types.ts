// Re-export SDK types that consumers will need
export type {
  RoolSpaceInfo,
  RoolObject,
  RoolUserRole,
  ConnectionState,
  ConversationInfo,
  Interaction,
  FindObjectsOptions,
  PromptOptions,
} from '@rool-dev/sdk';

// Re-export types from our modules
export type { Rool } from './rool.svelte.js';
export type { SpaceHandle, SpaceInfo, AsyncValue, CreateObjectOptions, UpdateObjectOptions } from './space.svelte.js';
