# Rool Svelte

Svelte 5 bindings for Rool Spaces. Adds reactive state to the SDK using `$state` runes.

**Requires Svelte 5.** For core concepts (objects, relations, AI placeholders, undo/redo), see the [SDK documentation](../sdk/README.md).

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

  let currentSpace = $state(null);
</script>

{#if !rool.authenticated}
  <button onclick={() => rool.login('My App')}>Login</button>
{:else}
  <h1>My Spaces</h1>
  {#each rool.spaces ?? [] as space}
    <button onclick={async () => currentSpace = await rool.openSpace(space.id)}>
      {space.name}
    </button>
  {/each}

  {#if currentSpace}
    <p>Interactions: {currentSpace.interactions.length}</p>
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
| `space.interactions` | Conversation interactions (auto-updates) |
| `collection.objects` | Objects matching a filter (auto-updates) |
| `collection.loading` | Whether collection is loading |

Everything else passes through to the SDK directly. See the [SDK documentation](../sdk/README.md) for full API details.

## API

### Lifecycle

```typescript
const rool = createRool();

rool.init();              // Process auth callbacks (call on app startup)
rool.login('My App');     // Redirect to login page
rool.logout();            // Clear auth state and close all spaces
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

### Opening Spaces

```typescript
const space = await rool.openSpace('space-id');
const space = await rool.openSpace('space-id', { conversationId: 'my-convo' });
const space = await rool.createSpace('My New Space');

// Multiple spaces can be open at once
const spaceA = await rool.openSpace('space-a');
const spaceB = await rool.openSpace('space-b');

// Clean up
space.close();
```

### ReactiveSpace

`openSpace` and `createSpace` return a `ReactiveSpace` — the SDK's `RoolSpace` with reactive `interactions`:

```svelte
<script>
  let space = $state(null);

  async function open(id) {
    space = await rool.openSpace(id);
  }
</script>

{#if space}
  <!-- Reactive: updates as AI makes tool calls -->
  {#each space.interactions as interaction}
    <div>
      <strong>{interaction.operation}</strong>: {interaction.output}
    </div>
  {/each}

  <!-- All SDK methods work directly -->
  <button onclick={() => space.prompt('Hello')}>Send</button>
{/if}
```

### Reactive Collections

Create auto-updating collections of objects filtered by field values:

```svelte
<script>
  let space = $state(null);
  let articles = $state(null);

  async function open(id) {
    space = await rool.openSpace(id);
    // Create a reactive collection of all objects where type === 'article'
    articles = space.collection({ where: { type: 'article' } });
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

Collections automatically re-fetch when objects matching the filter are created, updated, or deleted. Since the SDK caches objects locally, re-fetches are typically instant (no network round-trip).

```typescript
// Collection options (same as findObjects, but no AI prompt)
const articles = space.collection({
  where: { type: 'article', status: 'published' },
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

### Using the SDK

All `RoolSpace` methods and properties are available on `ReactiveSpace`:

```typescript
// Properties
space.id
space.name
space.role
space.conversationId

// Object operations
await space.getObject(id)
await space.createObject({ data: { type: 'note', text: 'Hello' } })
await space.updateObject(id, { data: { text: 'Updated' } })
await space.deleteObjects([id])
await space.findObjects({ where: { type: 'note' } })

// Relations
await space.link(sourceId, 'references', targetId)
await space.unlink(sourceId, 'references', targetId)
await space.getChildren(id, 'references')
await space.getParents(id, 'references')

// AI
await space.prompt('Summarize everything')

// Undo/Redo
await space.checkpoint('Before edit')
await space.undo()
await space.redo()

// Conversations
await space.setSystemInstruction('You are helpful')
await space.renameConversation('id', 'Research')
space.getInteractions()
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
import type { Rool, ReactiveSpace, ReactiveCollection, CollectionOptions } from '@rool-dev/svelte';

// Re-exported from @rool-dev/sdk
import type {
  RoolSpace,
  RoolSpaceInfo,
  RoolObject,
  RoolUserRole,
  ConnectionState,
  ConversationInfo,
  Interaction,
  FindObjectsOptions,
  PromptOptions,
  CreateObjectOptions,
  UpdateObjectOptions,
} from '@rool-dev/svelte';
```

## Examples

- [soft-sql](../../examples/soft-sql) — SQL-style natural language queries with live tool call progress
- [flashcards](../../examples/flashcards) — Spaced repetition with AI-generated cards

## License

MIT - see [LICENSE](../../LICENSE) for details.
