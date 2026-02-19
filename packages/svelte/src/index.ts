// Main export
export { createRool, generateId } from './rool.svelte.js';

// Reactive space wrapper
export { wrapSpace } from './space.svelte.js';

// Types
export type { Rool } from './rool.svelte.js';
export type { ReactiveSpace } from './space.svelte.js';

// Re-export SDK types for convenience
export type {
  RoolClientConfig,
  RoolSpace,
  RoolSpaceInfo,
  RoolObject,
  RoolUserRole,
  ConnectionState,
  ConversationInfo,
  CurrentUser,
  Interaction,
  FindObjectsOptions,
  PromptOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
} from '@rool-dev/sdk';
