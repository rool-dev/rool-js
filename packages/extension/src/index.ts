/**
 * @rool-dev/extension — Svelte-first extension SDK for Rool.
 *
 * `initExtension()` connects to the host via the iframe bridge and returns
 * a reactive channel with $state properties, matching the @rool-dev/svelte API.
 */

// Public API — reactive channel
export { initExtension } from './reactive.svelte.js';
export type { ReactiveChannel, ReactiveConversationHandle, ReactiveObject, ReactiveWatch, WatchOptions } from './reactive.svelte.js';

// Bridge types
export type { BridgeUser } from './protocol.js';

// Types
export type {
  RoolObject,
  RoolObjectStat,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  FieldType,
  Interaction,
  InteractionStatus,
  ConversationInfo,
  ToolCall,
  PromptOptions,
  PromptEffort,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  ChangeSource,
  RoolUserRole,
  LinkAccess,
  ChannelEvents,
} from './types.js';
