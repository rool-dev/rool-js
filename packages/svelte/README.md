# Rool Svelte

Svelte 5 bindings for Rool Spaces. Adds reactive state to the SDK using `$state` runes.

> **Building a new Rool extension?** Start with [`@rool-dev/extension`](/extension/) — it includes a reactive channel and handles hosting for you. This package is for integrating Rool into an existing Svelte application that manages its own auth, routing, and build setup.

**Requires Svelte 5.** For core concepts (objects, references, AI placeholders, undo/redo), see the [SDK documentation](../sdk/README.md).

## Installation

```bash
npm install @rool-dev/svelte
```

## Quick Start

```svelte
<script>
  import { createRool } from '@rool-dev/svelte';

  const rool = createRool();
  rool.init();

  let channel = $state(null);
</script>

{#if !rool.authenticated}
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
| `rool.spaces` | List of available spaces |
| `rool.spacesLoading` | Whether spaces are loading |
| `rool.spacesError` | Error from loading spaces |
| `rool.connectionState` | SSE connection state |
| `rool.userStorage` | User storage (cross-device preferences) |
| `channel.interactions` | Channel interactions (auto-updates) |
| `channel.objectIds` | All object IDs in the space (auto-updates on create/delete) |
| `channel.collections` | Collection names from the schema (auto-updates) |
| `channel.conversations` | Conversations in this channel (auto-updates on create/delete/rename) |
| `thread.interactions` | Interactions for a specific conversation (auto-updates) |
| `watch.objects` | Objects matching a filter (auto-updates) |
| `watch.loading` | Whether watch is loading |

Everything else passes through to the SDK directly. See the [SDK documentation](../sdk/README.md) for full API details.

## API

### Lifecycle

```typescript
const rool = createRool();

rool.init();              // Process auth callbacks (call on app startup)
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
<script>
  const rool = createRool();
  rool.init();
</script>

<!-- Reactive binding to storage values -->
{#if rool.userStorage.onboarding_complete}
  <Dashboard />
{:else}
  <Onboarding onstep={(step) => rool.setUserStorage('onboarding_step', step)} />
{/if}

<!-- Theme toggle -->
<button onclick={() => rool.setUserStorage('theme',
  rool.userStorage.theme === 'dark' ? 'light' : 'dark'
)}>
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
await space.addUser(userId, 'editor');

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

`space.openChannel()` returns a `ReactiveChannel` — the SDK's `RoolChannel` with reactive `interactions` and `objectIds`:

```svelte
<script>
  let space = $state(null);
  let channel = $state(null);

  async function open(spaceId) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
  }
</script>

{#if channel}
  <!-- Reactive: updates as AI makes tool calls -->
  {#each channel.interactions as interaction}
    <div>
      <strong>{interaction.operation}</strong>: {interaction.output}
    </div>
  {/each}

  <!-- All SDK methods work directly -->
  <button onclick={() => channel.prompt('Hello')}>Send</button>
{/if}
```

### Reactive Object

Track a single object by ID with auto-updates:

```svelte
<script>
  let channel = $state(null);
  let item = $state(null);

  let space = $state(null);

  async function open(spaceId, objectId) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
    item = channel.object(objectId);
  }
</script>

{#if item}
  {#if item.loading}
    <p>Loading...</p>
  {:else if item.data}
    <div>{item.data.title}</div>
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
<script>
  let channel = $state(null);
  let articles = $state(null);

  let space = $state(null);

  async function open(spaceId) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
    // Create a reactive watch of all objects where type === 'article'
    articles = channel.watch({ collection: 'article' });
  }
</script>

{#if articles}
  {#if articles.loading}
    <p>Loading...</p>
  {:else}
    {#each articles.objects as article}
      <div>{article.title}</div>
    {/each}
  {/if}
{/if}
```

Watches automatically re-fetch when objects matching the filter are created, updated, or deleted. Since the SDK caches objects locally, re-fetches are typically instant (no network round-trip).

**Lifecycle:** Watches are tied to their channel. Closing the channel stops all updates — existing watches will retain their last data but no longer refresh. Calling `channel.watch()` after `close()` throws.

```typescript
// Watch options (same as findObjects, but no AI prompt)
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

`space.channels` is a reactive `ChannelInfo[]` that auto-updates as channels are created, renamed, or deleted.

```svelte
<script>
  let space = $state(null);

  async function open(spaceId) {
    space = await rool.openSpace(spaceId);
  }
</script>

{#if space}
  {#each space.channels as ch}
    <button onclick={() => space.openChannel(ch.id)}>{ch.name ?? ch.id}</button>
  {/each}
{/if}
```

### Reactive Conversation Handle

For apps with multiple independent interaction threads (e.g., chat with threads), use `channel.conversation()` to get a handle with reactive interactions:

```svelte
<script>
  let channel = $state(null);
  let thread = $state(null);

  let space = $state(null);

  async function openThread(spaceId, threadId) {
    space = await rool.openSpace(spaceId);
    channel = await space.openChannel('main');
    thread = channel.conversation(threadId);
  }
</script>

{#if thread}
  {#each thread.interactions as interaction}
    <div>{interaction.output}</div>
  {/each}

  <button onclick={() => thread.prompt('Hello')}>Send</button>
{/if}
```

```typescript
// Reactive state
thread.interactions   // $state<Interaction[]> — auto-updates via SSE

// All conversation-scoped methods
await thread.prompt('Hello')
await thread.createObject({ data: { type: 'note', text: 'Note' } })
await thread.setSystemInstruction('Respond in haiku')
await thread.rename('Research Thread')
thread.getInteractions()      // Manual read
thread.getSystemInstruction()

// Cleanup
thread.close()   // Stop listening for updates
```

Conversations are auto-created on first interaction. All conversations share one SSE connection per channel.

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

// Object operations
await channel.getObject(id)
await channel.createObject({ data: { type: 'note', text: 'Hello' } })
await channel.updateObject(id, { data: { text: 'Updated' } })
await channel.deleteObjects([id])
await channel.findObjects({ collection: 'note' })

// AI
await channel.prompt('Summarize everything')

// Schema
channel.getSchema()
await channel.createCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'enum', values: ['draft', 'published'] } },
])
await channel.alterCollection('article', [...updatedProps])
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
// thread.interactions is reactive $state — auto-updates via SSE
thread.close();                      // Stop listening when done

// Channel admin
await channel.rename('New Name')
```

See the [SDK documentation](../sdk/README.md) for complete API details.

### Utilities

```typescript
import { generateId } from '@rool-dev/svelte';

// Generate a 6-character alphanumeric ID
const id = generateId();
```

## Exported Types

```typescript
// Package types
import type { Rool, ReactiveChannel, ReactiveConversationHandle, ReactiveObject, ReactiveWatch, WatchOptions, ReactiveChannelList } from '@rool-dev/svelte';

// Re-exported from @rool-dev/sdk
import type {
  RoolClient,
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
  FieldType,
  FieldDef,
  CollectionDef,
  SpaceSchema,
  SpaceMember,
  UserResult,
  PublishedExtensionInfo,
  PublishExtensionOptions,
  ExtensionManifest,
  FindExtensionsOptions,

} from '@rool-dev/svelte';
```

## Examples

- [soft-sql](../../examples/soft-sql) — SQL-style natural language queries with live tool call progress
- [flashcards](../../examples/flashcards) — Spaced repetition with AI-generated cards

## License

MIT - see [LICENSE](../../LICENSE) for details.
