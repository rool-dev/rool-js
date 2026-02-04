# Rool Svelte

Svelte 5 bindings for Rool Spaces. Transforms the event-based SDK into reactive state using `$state` runes.

**Requires Svelte 5.** For core concepts (objects, relations, AI placeholders, undo/redo), see the [SDK documentation](https://docs.rool.dev/sdk/).

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
</script>

{#if !rool.authenticated}
  <button onclick={() => rool.login('My App')}>Login</button>
{:else}
  <h1>My Spaces</h1>
  {#each rool.spaces ?? [] as space}
    <button onclick={() => rool.openSpace(space.id)}>
      {space.name}
    </button>
  {/each}
{/if}
```

## API

### Lifecycle

```typescript
const rool = createRool();

rool.init();              // Process auth callbacks (call on app startup)
rool.login('My App');     // Redirect to login page
rool.logout();            // Clear auth state
rool.destroy();           // Clean up all resources
```

### Client State (Always Available)

```svelte
<script>
  // Direct property access - automatically reactive
  // rool.authenticated    → boolean
  // rool.spaces           → RoolSpaceInfo[] | undefined
  // rool.spacesLoading    → boolean
  // rool.spacesError      → Error | null
  // rool.connectionState  → 'connected' | 'disconnected' | 'reconnecting'
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

### Space Lifecycle

Opening a space returns a `SpaceHandle` with reactive state and methods:

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

### Space State

```svelte
<script>
  // space.info              → { id, name, role }
  // space.conversationId    → string
  // space.conversations     → ConversationInfo[] | undefined
  // space.conversationsLoading → boolean
  // space.interactions      → Interaction[]
  // space.systemInstruction → string | undefined
</script>

<h1>{space.info.name}</h1>
<p>Role: {space.info.role}</p>

<!-- Conversation picker -->
<select onchange={(e) => space.setConversationId(e.target.value)}>
  {#each space.conversations ?? [] as conv}
    <option value={conv.id} selected={conv.id === space.conversationId}>
      {conv.name ?? 'Untitled'}
    </option>
  {/each}
</select>

<!-- Chat messages -->
{#each space.interactions as interaction}
  <div class="message">
    <strong>{interaction.operation}</strong>
    <p>{interaction.output}</p>
  </div>
{/each}
```

### Object Factories

Object state is created via factory functions and cached by arguments. Each returns an `AsyncValue` with reactive `value`, `loading`, and `error` properties.

```svelte
<script>
  // Single object
  const sun = space.object('sun-id');
  // sun.value   → RoolObject | undefined
  // sun.loading → boolean
  // sun.error   → Error | null

  // Children (objects this object links TO)
  const planets = space.children('sun-id', 'hasPlanet');

  // Parents (objects that link TO this object)
  const stars = space.parents('earth-id', 'orbits');

  // Query (manual refresh only)
  const articles = space.query({ where: { type: 'article' } });
</script>

{#if sun.loading}
  <p>Loading...</p>
{:else if sun.error}
  <p>Error: {sun.error.message}</p>
{:else if sun.value}
  <h1>{sun.value.name}</h1>
{/if}

<!-- Manual refresh -->
<button onclick={() => articles.refresh()}>Refresh</button>
```

### Mutations

All mutations are async and pass through to the underlying SDK.

```typescript
// Create objects
const { object, message } = await space.createObject({
  data: { type: 'article', title: 'Hello World' }
});

// Update objects
await space.updateObject(object.id, {
  data: { status: 'published' }
});

// Delete objects
await space.deleteObjects([object.id]);

// Links
await space.link(sourceId, 'references', targetId);
await space.unlink(sourceId, 'references', targetId);

// AI prompt
const { message, objects } = await space.prompt(
  'Create a summary of all articles'
);

// Undo/Redo
await space.checkpoint('Before edit');
await space.updateObject(id, { data: { title: 'New title' } });
await space.undo();  // Reverts the update
await space.redo();  // Reapplies the update
```

### Conversation Management

```typescript
space.setConversationId('new-convo-id');
await space.setSystemInstruction('You are a helpful assistant');
await space.renameConversation('convo-id', 'Research Thread');
await space.deleteConversation('convo-id');
```

### Utilities

```typescript
import { generateId } from '@rool-dev/svelte';

// Generate a 6-character alphanumeric ID (same as RoolClient.generateId())
const id = generateId();
```

## Auto-Refresh Behavior

| State | Auto-refreshes on |
|-------|-------------------|
| `object(id)` | `objectUpdated`/`objectDeleted` for that ID |
| `children(id, rel)` | `linked`/`unlinked` events + member object updates |
| `parents(id, rel)` | `linked`/`unlinked` events + member object updates |
| `query(options)` | Never (call `refresh()` manually) |
| `rool.spaces` | `spaceCreated`/`spaceDeleted`/`spaceRenamed` |
| `space.conversations` | `conversationsChanged` |
| `space.interactions` | `conversationUpdated` + `conversationIdChanged` |

## AsyncValue Interface

Object factories return `AsyncValue` instances:

```typescript
class AsyncValue<T> {
  value: T | undefined;      // The data (reactive)
  loading: boolean;          // Loading state (reactive)
  error: Error | null;       // Last error (reactive)
  refresh(): Promise<void>;  // Manually refresh
}
```

## Design Principles

1. **Svelte 5 runes** — Uses `$state` for reactivity, no legacy stores
2. **Direct property access** — No `$` prefix needed, just access properties
3. **Go through the API** — Never exposes raw space data, all access via SDK methods
4. **Auto-refresh where safe** — Object/relation state auto-refreshes; queries are manual
5. **Caching** — Factory functions return cached instances by arguments

## Exported Types

```typescript
// Package types
import type {
  Rool,
  SpaceHandle,
  SpaceInfo,
  AsyncValue,
} from '@rool-dev/svelte';

// Re-exported from @rool-dev/sdk
import type {
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

See the [svelte-chat example](https://github.com/rool-dev/rool-js/tree/main/examples/svelte-chat) for a complete working app.

## License

MIT - see [LICENSE](../../LICENSE) for details.
