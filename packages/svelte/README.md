# Rool Svelte

Svelte 5 bindings for Rool Spaces. Adds reactive state to the SDK using `$state` runes.

**Requires Svelte 5.** For core concepts (objects, references, AI, WebDAV files, undo/redo), see the [SDK documentation](../sdk/README.md).

## Installation

```bash
npm install @rool-dev/svelte
```

## Quick Start

```svelte
<script lang="ts">
  import { createRool, type ReactiveChannel } from '@rool-dev/svelte';

  const rool = createRool();
  void rool.init();

  let channel = $state<ReactiveChannel | null>(null);
</script>

{#if rool.authenticated === null}
  <p>Checking session...</p>
{:else if !rool.authenticated}
  <button onclick={() => rool.login('My App')}>Login</button>
{:else}
  <h1>My Spaces</h1>
  {#each rool.spaces ?? [] as spaceInfo}
    <button onclick={async () => {
      const space = await rool.openSpace(spaceInfo.id);
      channel = await space.openChannel('main');
    }}>
      {spaceInfo.name}
    </button>
  {/each}

  {#if channel}
    <p>Interactions: {channel.interactions.length}</p>
  {/if}
{/if}
```

## What It Provides

The Svelte wrapper adds reactive state on top of the SDK:

| Reactive Property | Description |
|-------------------|-------------|
| `rool.authenticated` | Auth state (`null` = checking, `true`/`false` = known) |
| `rool.currentUser` | Current user profile after authentication |
| `rool.spaces` | List of available spaces |
| `rool.spacesLoading` | Whether spaces are loading |
| `rool.spacesError` | Error from loading spaces |
| `rool.connectionState` | Client SSE connection state |
| `rool.userStorage` | User storage (cross-device preferences) |
| `space.fileTree` | Canonical reactive WebDAV tree for `/`, including `/space` objects and `/rool-drive` user files |
| `channel.interactions` | Current conversation interactions |
| `channel.objectPaths` | Object paths derived from `space.fileTree` |
| `channel.collections` | Collection directories derived from `space.fileTree` |
| `channel.conversations` | Conversations in this channel (auto-updates on create/delete/rename) |
| `thread.interactions` | Interactions for a specific conversation (auto-updates) |
| `watch.objects` | Objects matching a filter (auto-updates) |
| `watch.loading` | Whether watch is loading |

Everything else passes through to the SDK directly. See the [SDK documentation](../sdk/README.md) for full API details.

### Reactive File Tree

Every `ReactiveSpace` owns a canonical reactive WebDAV tree. It is kept current with server `filesChanged`/`filesReset` events and WebDAV `sync-collection`, so it covers both object files and user files without polling.

```ts
const space = await rool.openSpace(spaceId);

space.fileTree.nodes;              // ReactiveFileNode[]
space.fileTree.byPath['/space'];   // lookup by machine/WebDAV path
space.fileTree.childrenOf('/');    // /space and /rool-drive
space.fileTree.childrenOf('/rool-drive');
space.fileTree.objectPaths();      // object paths from /space/**/*.json
```

Use this tree when UI needs to react to both files and objects. Object helpers like `channel.object()`, `channel.watch()`, `channel.objectPaths`, and `channel.collections` are backed by this tree.

## API

### Lifecycle

```typescript
const rool = createRool();

void rool.init();         // Process auth callbacks (call on app startup)
rool.login('My App');     // Redirect to login page
rool.signup('My App');    // Redirect to signup page
rool.verify(token);       // Sign in from an email verification link (used by the official Rool app)
rool.logout();            // Clear auth state and close all open spaces
rool.destroy();           // Clean up all resources
```

### Client State

```svelte
<script>
  // All properties are reactive $state
  // rool.authenticated    → boolean | null
  // rool.spaces           → RoolSpaceInfo[] | undefined
  // rool.spacesLoading    → boolean
  // rool.spacesError      → Error | null
  // rool.connectionState  → 'connected' | 'disconnected' | 'reconnecting'
  // rool.userStorage      → Record<string, unknown>
  // rool.currentUser      → CurrentUser | null
</script>

{#if rool.spacesLoading}
  <p>Loading spaces...</p>
{:else if rool.spacesError}
  <p>Error: {rool.spacesError.message}</p>
{:else}
  {#each rool.spaces ?? [] as space}
    <div>{space.name}</div>
  {/each}
{/if}
```

### User Storage

Reactive cross-device storage for user preferences. Synced from server on `init()`, then kept up-to-date via SSE.

```svelte
<script lang="ts">
  import { createRool } from '@rool-dev/svelte';
  const rool = createRool();
  void rool.init();
</script>

<!-- Reactive binding to storage values -->
{#if rool.userStorage.onboarding_complete}
  <Dashboard />
{:else}
  <Onboarding onstep={(step) => rool.setUserStorage('onboarding_step', step)} />
{/if}

<!-- Theme toggle -->
<button onclick={() => rool.setUserStorage('theme', rool.userStorage.theme === 'dark' ? 'light' : 'dark')}>
  Toggle theme
</button>
```

### Spaces & Channels

Every space has its own SSE subscription. Open a space, then open channels on it. Call `space.close()` when done — this closes all open channels and stops the subscription.

```typescript
// Open a space — reactive, with SSE
const space = await rool.openSpace('space-id');

// Open channels on the space
const channel = await space.openChannel('my-channel');
const other = await space.openChannel('research');  // Independent channel, same space

// Space admin
await space.rename('New Name');
const invite = await space.createInvite('editor');  // share invite.url
await space.setUserRole(userId, 'admin');

// Create a new space
const fresh = await rool.createSpace('My New Space');
const ch = await fresh.openChannel('main');

// Import from a zip archive
const imported = await rool.importArchive('Imported', archiveBlob);

// Delete a space permanently
await rool.deleteSpace('space-id');

// Clean up — closes all open channels AND stops the subscription
space.close();
```

### ReactiveChannel

`space.openChannel()` returns a `ReactiveChannel` — the SDK's `RoolChannel` with reactive `interactions`, `objectPaths`, `collections`, `conversations`, and file-tree-backed object helpers:

```svelte
<script lang="ts">
  import { createRool, type ReactiveChannel, type ReactiveSpace } from '@rool-dev/svelte';

  const rool = createRool();
  void rool.init();

  let space = $state<ReactiveSpace | null>(null);
  let channel = $state<ReactiveChannel | null>(null);

  async function open(spaceId: string) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
  }
</script>

{#if channel}
  <!-- Reactive: updates when the current conversation changes -->
  {#each channel.interactions as interaction}
    <div>
      <strong>{interaction.operation}</strong>: {interaction.output ?? ''}
    </div>
  {/each}

  <!-- All SDK methods work directly -->
  <button onclick={() => void channel.prompt('Hello')}>Send</button>
{/if}
```

### Reactive Object

Track a single object by machine path with auto-updates:

```svelte
<script lang="ts">
  import { createRool, type ReactiveChannel, type ReactiveObject } from '@rool-dev/svelte';

  const rool = createRool();
  void rool.init();

  let channel = $state<ReactiveChannel | null>(null);
  let item = $state<ReactiveObject | null>(null);

  async function open(spaceId: string, path: string) {
    const space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
    item = channel.object(path);  // e.g. '/space/article/welcome.json'
  }
</script>

{#if item}
  {#if item.loading}
    <p>Loading...</p>
  {:else if item.data}
    <div>{String(item.data.body.title ?? '')}</div>
  {:else}
    <p>Object not found</p>
  {/if}
{/if}
```

```typescript
// Reactive state
item.data      // $state<RoolObject | undefined>
item.loading   // $state<boolean>

// Methods
item.refresh() // Manual re-fetch
item.close()   // Stop listening for updates
```

**Lifecycle:** Reactive objects are tied to their channel. Closing the channel stops all updates — existing reactive objects will retain their last data but no longer refresh. Calling `channel.object()` after `close()` throws.

### Reactive Watches

Create auto-updating watches of objects filtered by field values:

```svelte
<script lang="ts">
  import { createRool, type ReactiveChannel, type ReactiveSpace, type ReactiveWatch } from '@rool-dev/svelte';

  const rool = createRool();
  void rool.init();

  let space = $state<ReactiveSpace | null>(null);
  let channel = $state<ReactiveChannel | null>(null);
  let articles = $state<ReactiveWatch | null>(null);
  async function open(spaceId: string) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
    // Create a reactive watch of all objects in the 'article' collection
    articles = channel.watch({ collection: 'article' });
  }
</script>

{#if articles}
  {#if articles.loading}
    <p>Loading...</p>
  {:else}
    {#each articles.objects as article}
      <div>{String(article.body.title ?? '')}</div>
    {/each}
  {/if}
{/if}
```

Watches automatically re-fetch when matching object files change in `space.fileTree`.

**Lifecycle:** Watches are tied to their channel. Closing the channel stops all updates — existing watches will retain their last data but no longer refresh. Calling `channel.watch()` after `close()` throws.

```typescript
// Watch options
const articles = channel.watch({
  collection: 'article',
  where: { status: 'published' },
  order: 'desc',  // by modifiedAt (default)
  limit: 20,
});

// Reactive state
articles.objects   // $state<RoolObject[]>
articles.loading   // $state<boolean>

// Methods
articles.refresh() // Manual re-fetch
articles.close()   // Stop listening for updates
```

### Reactive Channel List

`space.channels` is a reactive `ChannelInfo[]` on an opened `ReactiveSpace`. If you only need a live channel list without managing a `ReactiveSpace`, use `rool.channels(spaceId)` and call `close()` when done.

```svelte
<script lang="ts">
  import { createRool, type ReactiveSpace } from '@rool-dev/svelte';

  const rool = createRool();
  void rool.init();

  let space = $state<ReactiveSpace | null>(null);
  async function open(spaceId: string) {
    space = await rool.openSpace(spaceId);
  }
</script>

{#if space}
  {#each space.channels as ch}
    <button onclick={() => void space.openChannel(ch.id)}>{ch.name ?? ch.id}</button>
  {/each}
{/if}
```

```typescript
const channels = rool.channels(spaceId);
channels.list;       // ChannelInfo[]
channels.loading;    // boolean
await channels.refresh();
channels.close();
```

### Reactive Conversation Handle

For apps with multiple independent interaction threads (e.g., chat with threads), use `channel.conversation()` to get a handle with reactive interactions:

```svelte
<script lang="ts">
  import { createRool, type ReactiveChannel, type ReactiveConversationHandle, type ReactiveSpace } from '@rool-dev/svelte';

  const rool = createRool();
  void rool.init();

  let space = $state<ReactiveSpace | null>(null);
  let channel = $state<ReactiveChannel | null>(null);
  let thread = $state<ReactiveConversationHandle | null>(null);
  async function openThread(spaceId: string, threadId: string) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
    thread = channel.conversation(threadId);
  }
</script>

{#if thread}
  {#each thread.interactions as interaction}
    <div>{interaction.output}</div>
  {/each}

  <button onclick={() => void thread.prompt('Hello')}>Send</button>
{/if}
```

```typescript
// Reactive state
thread.interactions   // $state<Interaction[]> — updates from space/channel events

// Conversation-scoped methods
await thread.prompt('Hello')
await thread.stop()   // Stop this thread's in-flight interaction (false if none)
await thread.putObject('/space/note/welcome.json', { text: 'Note' })
await thread.patchObject('/space/note/welcome.json', { data: { text: 'Updated' } })
await thread.setSystemInstruction('Respond in haiku')
await thread.rename('Research Thread')
thread.getInteractions()      // Manual read
thread.getSystemInstruction()

// Cleanup
thread.close()   // Stop listening for updates
```

Conversations are auto-created when you first write history or settings. Real-time events are owned by the space subscription; conversation handles subscribe to channel events locally.

### Channel Management

```typescript
// Rename a channel on the space handle
await space.renameChannel('channel-id', 'New Name');

// Delete a channel
await space.deleteChannel('channel-id');

// Rename from within an open channel
await channel.rename('New Name');
```

### Using the SDK

All `RoolChannel` methods and properties are available on `ReactiveChannel`:

```typescript
// Properties
channel.id
channel.name
channel.role
channel.channelId

// Object operations — addressed by exact machine paths
const path = '/space/note/welcome.json';
await channel.getObject(path)
await channel.putObject(path, { text: 'Hello' })
await channel.patchObject(path, { data: { text: 'Updated' } })
await channel.moveObject(path, '/space/note/renamed.json')
await channel.deleteObjects(['/space/note/renamed.json'])

// AI
await channel.prompt('Summarize everything')
await channel.stop()                       // Stop the in-flight interaction (false if none)
await channel.stopInteraction(channel.activeLeafId!)  // Stop a specific interaction by ID

// Schema
channel.getSchema()
await channel.createCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'enum', values: ['draft', 'published'] } },
])
await channel.alterCollection('article', updatedFields)
await channel.dropCollection('article')

// Undo/Redo
await channel.checkpoint('Before edit')
await channel.undo()
await channel.redo()

// Interaction history & conversations
await channel.setSystemInstruction('You are helpful')
channel.getInteractions()
channel.getConversations()
await channel.deleteConversation('old-thread')
await channel.renameConversation('Research')

// Conversation handles (reactive interactions for specific conversations)
const thread = channel.conversation('thread-42');
await thread.prompt('Hello');        // Uses thread-42's interaction history
// thread.interactions is reactive $state — updates from space/channel events
thread.close();                      // Stop listening when done

// Channel admin
await channel.rename('New Name')
```

See the [SDK documentation](../sdk/README.md) for complete API details.

### Utilities

```typescript
import { machinePath, machineUri, isObjectPath, generateId } from '@rool-dev/svelte';

machinePath('rool-machine:/rool-drive/docs/read%20me.md');
// '/rool-drive/docs/read me.md'

machineUri('/space/article/welcome.json');
// 'rool-machine:/space/article/welcome.json'

isObjectPath('/space/article/welcome.json'); // true
generateId(); // 6-character alphanumeric ID
```

## Exported Types

```typescript
// Package types
import type { Rool, ReactiveSpace, ReactiveChannel, ReactiveConversationHandle, ReactiveObject, ReactiveWatch, WatchOptions, ReactiveChannelList, ReactiveFileTree, ReactiveFileNode, ReactiveFileRoot, ReactiveFileTreeEvent, ReactiveFileTreeSyncResult } from '@rool-dev/svelte';

// Re-exported from @rool-dev/sdk
import type {
  RoolClient,
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
  InviteRole,
  InviteEmailStatus,
  SpaceInvite,
  SpaceInviteCreated,
  InvitePreview,
  InviteRedeemResult,
  SpaceFileStorageUsage,
  RoolSpaceEvents,
  WebDAVDepth,
  WebDAVSyncLevel,
  WebDAVPropName,
  WebDAVResponse,
  WebDAVProps,
} from '@rool-dev/svelte';
```

## License

MIT - see [LICENSE](../../LICENSE) for details.
