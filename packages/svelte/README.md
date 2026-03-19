# Rool Svelte

Svelte 5 bindings for Rool Spaces. Adds reactive state to the SDK using `$state` runes.

> **Building a new Rool app?** Start with [`@rool-dev/app`](/app/) — it includes a reactive channel and handles hosting for you. This package is for integrating Rool into an existing Svelte application that manages its own auth, routing, and build setup.

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
  {#each rool.spaces ?? [] as space}
    <button onclick={async () => channel = await rool.openChannel(space.id, 'main')}>
      {space.name}
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
| `watch.objects` | Objects matching a filter (auto-updates) |
| `watch.loading` | Whether watch is loading |

Everything else passes through to the SDK directly. See the [SDK documentation](../sdk/README.md) for full API details.

## API

### Lifecycle

```typescript
const rool = createRool();

rool.init();              // Process auth callbacks (call on app startup)
rool.login('My App');     // Redirect to login page
rool.logout();            // Clear auth state and close all channels
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

```typescript
// Open a channel — reactive, with SSE
const channel = await rool.openChannel('space-id', 'my-channel');

// Create a space, then open a channel on it
const space = await rool.createSpace('My New Space');
const channel = await space.openChannel('main');

// Open a space for admin operations (lightweight, no SSE)
const space = await rool.openSpace('space-id');
await space.rename('New Name');
await space.addUser(userId, 'editor');

// Delete a space
await rool.deleteSpace('space-id');

// Import a space from a zip archive
const space = await rool.importArchive('Imported', archiveBlob);

// Clean up
channel.close();
```

### ReactiveChannel

`openChannel` returns a `ReactiveChannel` — the SDK's `RoolChannel` with reactive `interactions` and `objectIds`:

```svelte
<script>
  let channel = $state(null);

  async function open(spaceId) {
    channel = await rool.openChannel(spaceId, 'main');
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

  async function open(spaceId, objectId) {
    channel = await rool.openChannel(spaceId, 'main');
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

  async function open(spaceId) {
    channel = await rool.openChannel(spaceId, 'main');
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

List channels for a space with auto-updates:

```svelte
<script>
  const channelList = rool.channels('space-id');

  // Clean up when done
  import { onDestroy } from 'svelte';
  onDestroy(() => channelList.close());
</script>

{#if channelList.loading}
  <p>Loading channels...</p>
{:else}
  {#each channelList.list as ch}
    <button onclick={() => openChannel(ch.id)}>{ch.name ?? ch.id}</button>
  {/each}
{/if}
```

```typescript
// Reactive state
channelList.list      // $state<ChannelInfo[]>
channelList.loading   // $state<boolean>

// Methods
channelList.refresh() // Manual re-fetch
channelList.close()   // Stop listening for updates
```

### Channel Management

```typescript
// Rename a channel (thin GraphQL call, no SSE needed)
await rool.renameChannel('space-id', 'channel-id', 'New Name');

// Delete a channel
await rool.deleteChannel('space-id', 'channel-id');

// Rename from within a channel
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
await channel.createObject({ data: { text: 'Hello' } })
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

// Interaction history
await channel.setSystemInstruction('You are helpful')
channel.getInteractions()

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
import type { Rool, ReactiveChannel, ReactiveObject, ReactiveWatch, WatchOptions, ReactiveChannelList } from '@rool-dev/svelte';

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
  PublishedAppInfo,
  PublishAppOptions,
  AppManifest,
  FindAppsOptions,
} from '@rool-dev/svelte';
```

## Examples

- [soft-sql](../../examples/soft-sql) — SQL-style natural language queries with live tool call progress
- [flashcards](../../examples/flashcards) — Spaced repetition with AI-generated cards

## License

MIT - see [LICENSE](../../LICENSE) for details.
