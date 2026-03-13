/**
 * @rool-dev/app — Svelte-first app SDK for Rool.
 *
 * `initApp()` connects to the host via the iframe bridge and returns
 * a reactive channel with $state properties, matching the @rool-dev/svelte API.
 */

// Public API — reactive channel
export { initApp } from './reactive.svelte.js';
export type { ReactiveAppChannel, ReactiveObject, ReactiveWatch, WatchOptions } from './reactive.svelte.js';

// Types
export type {
  RoolObject,
  RoolObjectStat,
  SpaceSchema,
  CollectionDef,
  FieldDef,
  FieldType,
  Interaction,
  ToolCall,
  PromptOptions,
  PromptEffort,
  FindObjectsOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
  ChangeSource,
  RoolUserRole,
  LinkAccess,
  AppChannelEvents,
} from './types.js';
