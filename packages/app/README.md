# Rool App

Build sandboxed apps that run inside Rool Spaces. An app is a Svelte 5 component hosted in an iframe, communicating with the host via a postMessage bridge.

Apps are small, standardized, and easy to generate. An app project is just two files:

- **`App.svelte`** — Your UI component (receives a reactive channel as a prop)
- **`rool-app.json`** — Manifest with id, name, icon, visibility, and collection access

Everything else (Vite config, entry point, HTML, Tailwind CSS) is provided by the CLI.

## Quick Start

```bash
npx rool-app init my-app
cd my-app
pnpm install
npx rool-app dev
```

This opens a dev host at `/__rool-host/` that loads your app in a sandboxed iframe, connected to a real Rool Space.

## Manifest

`rool-app.json` declares your app's identity and collection access:

```json
{
  "id": "my-app",
  "name": "My App",
  "public": false,
  "icon": "icon.png",
  "description": "What this app does",
  "collections": {
    "write": {
      "task": [
        { "name": "title", "type": { "kind": "string" } },
        { "name": "done", "type": { "kind": "boolean" } }
      ]
    },
    "read": "*"
  },
  "systemInstruction": "Optional system instruction for the AI"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (lowercase, hyphens) |
| `name` | Yes | Display name |
| `public` | Yes | Whether the app is listed in the public app directory |
| `icon` | No | Path to an icon image file relative to the project root (e.g. `"icon.png"`) |
| `description` | No | Short description |
| `collections` | Yes | Collection access declarations — can be `{}` (see below) |
| `systemInstruction` | No | Default system instruction for the AI channel |

### Collection Access

The `collections` field declares what collections the app works with, grouped by access level:

- **`write`** — Collections the app can create, update, and delete objects in. An object with field definitions creates the collection in the space. `"*"` grants write access to all collections.
- **`read`** — Collections the app can read from. An object with field definitions declares the expected shape. `"*"` grants read access to all collections.

`write` implies `read` — no need to list a collection under both.

```json
// App with its own collections + read access to everything else
"collections": {
  "write": {
    "card": [
      { "name": "front", "type": { "kind": "string" } },
      { "name": "back", "type": { "kind": "string" } }
    ]
  },
  "read": "*"
}

// Full access to all collections (chat, SQL interface, etc.)
"collections": {
  "write": "*"
}

// Read-only access to all collections
"collections": {
  "read": "*"
}
```

## App Component

`App.svelte` receives a single prop — a `ReactiveAppChannel`:

```svelte
<script lang="ts">
  import type { ReactiveAppChannel } from '@rool-dev/app';

  interface Props {
    channel: ReactiveAppChannel;
  }

  let { channel }: Props = $props();
</script>

<div>
  <p>Connected to: {channel.spaceName}</p>
  <p>Objects: {channel.objectIds.length}</p>
  <button onclick={() => channel.prompt('Hello')}>Send</button>
</div>
```

The component can import other `.svelte` components and `.ts` files — standard Svelte/TypeScript conventions apply. Tailwind CSS v4 is available out of the box. Add an `app.css` file to include custom styles.

## ReactiveAppChannel

The channel is the app's interface to the host Space. It mirrors the `@rool-dev/svelte` ReactiveChannel API over a postMessage bridge.

### Reactive State

These are Svelte 5 `$state` properties — use them directly in templates or `$effect` blocks:

| Property | Type | Description |
|----------|------|-------------|
| `interactions` | `Interaction[]` | Channel interaction history (auto-updates) |
| `objectIds` | `string[]` | All object IDs in the space (auto-updates on create/delete) |
| `collections` | `string[]` | Collection names from the schema (auto-updates) |
| `conversations` | `ConversationInfo[]` | Conversations in this channel (auto-updates on create/delete/rename) |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `channelId` | `string` | Channel ID |
| `spaceId` | `string` | Space ID |
| `spaceName` | `string` | Space name |
| `role` | `RoolUserRole` | User's role (`owner`, `admin`, `editor`, `viewer`) |
| `linkAccess` | `LinkAccess` | URL sharing level |
| `userId` | `string` | Current user's ID |
| `isReadOnly` | `boolean` | True if viewer role |

### Object Operations

```typescript
await channel.getObject(id)
await channel.findObjects({ collection: 'note' })
await channel.findObjects({ collection: 'note', where: { status: 'active' } })
await channel.createObject({ data: { text: '{{expand this}}' } })
await channel.updateObject(id, { data: { text: 'Updated' } })
await channel.updateObject(id, { prompt: 'Make it shorter' })
await channel.deleteObjects([id])
channel.getObjectIds({ limit: 10, order: 'desc' })
```

See the [SDK docs](../sdk/README.md) for full details on object operations, `{{placeholder}}` syntax, and `findObjects` options.

### AI

```typescript
const { message, objects } = await channel.prompt('Create three tasks');
const { message } = await channel.prompt('Summarize', { readOnly: true, effort: 'QUICK' });
```

| Option | Description |
|--------|-------------|
| `objectIds` | Focus on specific objects |
| `responseSchema` | Request structured JSON response |
| `effort` | `'QUICK'`, `'STANDARD'`, `'REASONING'`, or `'RESEARCH'` |
| `ephemeral` | Don't record in interaction history |
| `readOnly` | Disable mutation tools |

### Schema

```typescript
channel.getSchema()
await channel.createCollection('task', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'done', type: { kind: 'boolean' } },
])
await channel.alterCollection('task', [...updatedFields])
await channel.dropCollection('task')
```

### Undo/Redo

```typescript
await channel.checkpoint('Before delete')
await channel.deleteObjects([id])
await channel.undo()   // restores deleted object
await channel.redo()   // deletes again
```

### Metadata

Arbitrary key-value storage on the Space (not visible to AI):

```typescript
channel.setMetadata('viewport', { zoom: 1.5 })
channel.getMetadata('viewport')
channel.getAllMetadata()
```

### Interaction History & Conversations

```typescript
channel.getInteractions()
channel.getSystemInstruction()
await channel.setSystemInstruction('Respond in haiku')

// List all conversations in this channel
channel.getConversations()

// Delete or rename a conversation
await channel.deleteConversation('old-thread')
await channel.renameConversation('Research')
```

### Conversation Handles

For apps that need multiple independent interaction threads (e.g., chat with multiple threads), use `channel.conversation()` to get a reactive handle scoped to a specific conversation:

```svelte
<script>
  const thread = channel.conversation('thread-42');
</script>

<!-- thread.interactions is reactive $state — auto-updates via SSE -->
{#each thread.interactions as interaction}
  <div>{interaction.output}</div>
{/each}

<button onclick={() => thread.prompt('Hello')}>Send</button>
```

```typescript
// Reactive state
thread.interactions   // $state<Interaction[]> — auto-updates

// All conversation-scoped methods
await thread.prompt('Hello');
await thread.createObject({ data: { text: 'Hello' } });
await thread.setSystemInstruction('Respond in haiku');
await thread.rename('Research Thread');

// Cleanup
thread.close();   // Stop listening for updates
```

Conversations are auto-created on first interaction — no explicit create step needed. All conversations share one bridge connection. See the [SDK docs](../sdk/README.md#conversations) for full details.

### Events

```typescript
channel.on('objectCreated', ({ objectId, object, source }) => { ... })
channel.on('objectUpdated', ({ objectId, object, source }) => { ... })
channel.on('objectDeleted', ({ objectId, source }) => { ... })
channel.on('metadataUpdated', ({ metadata, source }) => { ... })
channel.on('channelUpdated', ({ channelId, source }) => { ... })
channel.on('conversationUpdated', ({ conversationId, channelId, source }) => { ... })
channel.on('reset', ({ source }) => { ... })
```

`source` is `'local_user'`, `'remote_user'`, `'remote_agent'`, or `'system'`.

### Reactive Primitives

#### `channel.watch(options)`

Auto-updating filtered object list:

```svelte
<script>
  const tasks = channel.watch({ collection: 'task' });
</script>

{#each tasks.objects as task}
  <div>{task.title}</div>
{/each}
```

| State | Description |
|-------|-------------|
| `watch.objects` | `$state<RoolObject[]>` — matching objects |
| `watch.loading` | `$state<boolean>` — loading state |

Methods: `watch.refresh()`, `watch.close()`.

#### `channel.object(id)`

Single reactive object subscription:

```svelte
<script>
  const item = channel.object('abc123');
</script>

{#if item.data}
  <div>{item.data.title}</div>
{/if}
```

| State | Description |
|-------|-------------|
| `object.data` | `$state<RoolObject | undefined>` — object data |
| `object.loading` | `$state<boolean>` — loading state |

Methods: `object.refresh()`, `object.close()`.

## Hosting

Apps run in a sandboxed iframe (`allow-scripts allow-same-origin`). The host creates the iframe, establishes a postMessage bridge, and proxies all channel operations to a real Rool Space. The app never authenticates directly — the host handles auth and forwards operations.

The bridge protocol:
1. App sends `rool:ready`
2. Host responds with `rool:init` (channel metadata, schema, space info)
3. App calls channel methods → `rool:request` → host executes → `rool:response`
4. Host pushes real-time events → `rool:event` → app updates reactive state

## CLI Commands

| Command | Description |
|---------|-------------|
| `rool-app init [name]` | Scaffold a new app project |
| `rool-app dev` | Start the dev server with host shell |
| `rool-app build` | Build the app |
| `rool-app publish` | Build and publish the app |

## Exported Types

```typescript
import type {
  ReactiveAppChannel,
  ReactiveAppConversationHandle,
  ReactiveObject,
  ReactiveWatch,
  WatchOptions,
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
  AppChannelEvents,
} from '@rool-dev/app';
```

## License

MIT - see [LICENSE](../../LICENSE) for details.
