// Main export
export { createRool, generateId } from './rool.svelte.js';

// Reactive wrappers
export { wrapSpace } from './space.svelte.js';
export { ReactiveFileTree } from './file-tree.svelte.js';

// Types
export type { Rool } from './rool.svelte.js';
export type { ReactiveConversationHandle, ReactiveObject, ReactiveWatch, WatchOptions } from './space-session.svelte.js';
export type { ReactiveSpace } from './space.svelte.js';
export type { ReactiveFileNode, ReactiveFilePath, ReactiveFileRoot, ReactiveFileTreeEvent, ReactiveFileTreeSyncResult } from './file-tree.svelte.js';

// The SDK's entire public API (classes, helpers, errors, and types) is
// re-exported so apps never need a direct @rool-dev/sdk dependency.
export * from '@rool-dev/sdk';
