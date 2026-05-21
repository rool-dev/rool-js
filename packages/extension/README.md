# Rool Extension

An extension is a feature package that adds capabilities to a Rool Space. Extensions are Svelte 5 components hosted in sandboxed iframes, communicating with the host via a postMessage bridge. Each extension gets a reactive channel as its interface to the Space's objects, schema, AI, and real-time events.

Developers build extensions to create custom experiences on top of a Space — productivity tools, dashboards, data views, games, or anything else. Multiple extensions can be installed into the same Space, letting users and teams assemble an AI-powered interface that fits exactly how they work.

An extension project is just two files:

- **`App.svelte`** — Your UI component (receives a reactive channel as a prop)
- **`manifest.json`** — Manifest with id, name, icon, visibility, and collection access

Everything else (Vite config, entry point, HTML, Tailwind CSS) is provided by the CLI.

## Quick Start

```bash
npx @rool-dev/extension init my-extension
cd my-extension
npm install
npx rool-extension build
```

`build` outputs the bundled extension to `./dist`. Run `rool-extension --help` for the rest of the command surface.

## Manifest

`manifest.json` declares your extension's identity and collection access:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "icon": "icon.png",
  "description": "What this extension does",
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
| `icon` | No | Path to an icon image file relative to the project root (e.g. `"icon.png"`) |
| `description` | No | Short description |
| `collections` | Yes | Collection access declarations — can be `{}` (see below) |
| `systemInstruction` | No | Default system instruction for the AI channel |

### Collection Access

The `collections` field declares the collections the extension works with. Named collections with field definitions are scaffolded into the space's schema when the extension is installed (a collection of the same name is overwritten). The `read` and `write` keys are declarative — they describe the extension's intended use of each collection for marketplace listings and AI context. They are not enforced access control; what the user can actually do with objects is governed by their space role (`viewer`, `editor`, `admin`, `owner`).

- **`write`** — Collections the extension creates, updates, and deletes objects in. Use a field-definition list to scaffold a collection on install. `"*"` declares the extension may write to any collection.
- **`read`** — Collections the extension only reads from. `"*"` declares the extension may read from any collection.

Don't list the same collection under both — `write` already implies `read`.

```json
// Extension with its own scaffolded collection + reads anything else in the space
"collections": {
  "write": {
    "card": [
      { "name": "front", "type": { "kind": "string" } },
      { "name": "back", "type": { "kind": "string" } }
    ]
  },
  "read": "*"
}

// Operates on whatever the space already contains
"collections": {
  "write": "*"
}

// Pure consumer
"collections": {
  "read": "*"
}
```

## Extension Component

App.svelte receives a single prop — a `ReactiveChannel`:

```svelte
<script lang="ts">
  import type { ReactiveChannel } from '@rool-dev/extension';

  interface Props {
    channel: ReactiveChannel;
  }

  let { channel }: Props = $props();
</script>

<div>
  <p>Connected to: {channel.spaceName}</p>
  <p>Objects: {channel.objectLocations.length}</p>
  <button onclick={() => channel.prompt('Hello')}>Send</button>
</div>
```

The component can import other `.svelte` components and `.ts` files — standard Svelte/TypeScript conventions apply. Tailwind CSS v4 is available out of the box. Add an `app.css` file to include custom styles.

### Example: Task List

A complete extension that lets users add tasks, mark them done, and ask the AI to generate tasks from a description. The `watch` primitive keeps the list in sync with the Space in real-time.

```svelte
<script lang="ts">
  import type { ReactiveChannel } from '@rool-dev/extension';

  interface Props { channel: ReactiveChannel }
  let { channel }: Props = $props();

  const tasks = channel.watch({ collection: 'task' });

  let input = $state('');

  async function addTask() {
    if (!input.trim()) return;
    await channel.createObject('task', { title: input, done: false });
    input = '';
  }

  async function generate() {
    if (!input.trim()) return;
    await channel.prompt(`Create tasks for: ${input}`);
    input = '';
  }
</script>

<div class="flex gap-2 mb-4">
  <input bind:value={input} placeholder="New task or describe what you need…"
    class="flex-1 border rounded px-2 py-1" onkeydown={(e) => e.key === 'Enter' && addTask()} />
  <button onclick={addTask} class="px-3 py-1 bg-blue-600 text-white rounded">Add</button>
  <button onclick={generate} class="px-3 py-1 bg-violet-600 text-white rounded">AI Generate</button>
</div>

{#each tasks.objects as task (task.location)}
  <label class="flex items-center gap-2 py-1">
    <input type="checkbox" checked={task.body.done}
      onchange={() => channel.updateObject(task.location, { data: { done: !task.body.done } })} />
    <span class:line-through={task.body.done}>{task.body.title}</span>
  </label>
{/each}
```

This example covers the main patterns you'll use in most extensions: `watch` for a live query, `createObject` for direct mutations, `updateObject` for edits, and `prompt` to let the AI create or modify objects on the user's behalf.

### Dark Mode

Extensions automatically receive the host's color scheme. The `dark` class is toggled on the extension's `<html>` element, so Tailwind's `dark:` variants work out of the box — no configuration needed.

Use the `neutral` color scale for dark mode backgrounds and borders to match the host app:

| Surface | Light | Dark |
|---------|-------|------|
| Page background | `bg-slate-50` | `dark:bg-neutral-950` |
| Panels / cards | `bg-white` | `dark:bg-neutral-900` |
| Inset surfaces | `bg-slate-50` | `dark:bg-neutral-800` |
| Borders | `border-slate-200` | `dark:border-neutral-700` |
| Primary text | `text-slate-800` | `dark:text-neutral-100` |
| Secondary text | `text-slate-500` | `dark:text-neutral-400` |
| Inputs | `bg-slate-50` | `dark:bg-neutral-800` |

Accent colors (teal, violet, emerald, etc.) should shift to the `400` weight in dark mode for better contrast against dark backgrounds — e.g. `text-emerald-600 dark:text-emerald-400`.

The reactive `channel.colorScheme` property (`'light'` or `'dark'`) is available if you need to branch in code rather than CSS.

## ReactiveChannel

The channel is the extension's interface to the host Space — objects, schema, AI, metadata, undo/redo, and real-time events.

### Reactive State

These are Svelte 5 `$state` properties — use them directly in templates or `$effect` blocks:

| Property | Type | Description |
|----------|------|-------------|
| `interactions` | `Interaction[]` | Channel interaction history (auto-updates) |
| `objectLocations` | `string[]` | All object locations in the space (auto-updates on create/delete/move) |
| `collections` | `string[]` | Collection names from the schema (auto-updates) |
| `conversations` | `ConversationInfo[]` | Conversations in this channel (auto-updates on create/delete/rename) |
| `colorScheme` | `ColorScheme` | Host's color scheme: `'light'` or `'dark'` (auto-updates on toggle) |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `channelId` | `string` | Channel ID |
| `spaceId` | `string` | Space ID |
| `spaceName` | `string` | Space name |
| `role` | `RoolUserRole` | User's role (`owner`, `admin`, `editor`, `viewer`) |
| `linkAccess` | `LinkAccess` | URL sharing level |
| `userId` | `string` | Current user's ID |
| `user` | `BridgeUser` | Current user info (`{ id, name, email }`) |
| `isReadOnly` | `boolean` | True if viewer role |

### Object Operations

Every object lives at a **location** — a path of the form `/space/<collection>/<basename>.json`. Identity lives on the envelope (`location`, `collection`, `basename`); the `body` holds the user-defined fields and never contains `id` or `type`. References between objects are body fields whose values are location strings.

Methods that take a location accept either the canonical full form or the short form (`<collection>/<basename>`).

| Method | Description |
|--------|-------------|
| `getObject(location)` | Get the object, or undefined if not found |
| `findObjects(options)` | Find objects using filters and/or natural language (see below) |
| `getObjectLocations(options?)` | Get all object locations. Options: `{ limit?, order? }` |
| `createObject(collection, body, options?)` | Create a new object. Returns `{ object, message }` |
| `updateObject(location, options)` | Update an existing object's body. Returns `{ object, message }` |
| `moveObject(from, to, options?)` | Rename or relocate an object. Returns `{ object, message }` |
| `deleteObjects(locations)` | Delete objects by location |
| `stat(location)` | Get audit info (modifiedAt, modifiedBy, etc.) from local cache |

#### createObject / updateObject / moveObject

```typescript
// Create with an auto-generated basename — body must not contain id or type
await channel.createObject('article', { title: 'Hello', status: 'draft' })

// Pin the basename
await channel.createObject('article', { title: 'Hello' }, { basename: 'welcome' })
// → location: /space/article/welcome.json

// Use {{placeholders}} for AI-generated content
await channel.createObject('article', { headline: '{{catchy headline about coffee}}' })

// Update fields directly
await channel.updateObject(location, { data: { status: 'published' } })

// Update via AI instruction
await channel.updateObject(location, { prompt: 'Make it shorter and more casual' })

// Delete a field by setting it to null
await channel.updateObject(location, { data: { subtitle: null } })

// Rename within a collection (or move across collections)
await channel.moveObject(location, '/space/article/hello-world.json')

// Move and rewrite the body atomically
await channel.moveObject(location, newLocation, { body: { title: 'Hello, world' } })
```

Placeholders are resolved by the AI during the mutation and replaced with concrete values. The `{{...}}` syntax is never stored.

**createObject options:** `basename` (auto-generated if omitted), `ephemeral`, `parentInteractionId`. Body must not contain `id` or `type`.
**updateObject options:** `data` (body fields to add, update, or delete via `null`), `prompt`, `ephemeral`, `parentInteractionId`. Use `moveObject` to change identity.
**moveObject options:** `body` (atomically replace body), `ephemeral`, `parentInteractionId`.

#### findObjects

- **`where` only** — exact-match filtering, no AI, no credits
- **`collection` only** — filter by collection name, no AI, no credits
- **`prompt` only** — AI-powered semantic query over all objects
- **`where` + `prompt`** — `where` narrows the set first, then AI queries within it

```typescript
await channel.findObjects({ collection: 'note' })
await channel.findObjects({ where: { status: 'active' } })
await channel.findObjects({ collection: 'note', where: { status: 'active' } })
await channel.findObjects({ prompt: 'notes about climate solutions' })
await channel.findObjects({ collection: 'note', prompt: 'most urgent', limit: 5 })
```

Options: `where`, `collection`, `prompt`, `limit`, `locations`, `order` (`'asc'` | `'desc'`), `ephemeral`.

#### Hidden Fields

Body fields starting with `_` (e.g., `_ui`) are hidden from AI and ignored by the schema. Use them for UI state, positions, or other data the AI shouldn't see:

```typescript
await channel.createObject('note', { title: 'Note', _ui: { x: 100, y: 200 } })
```

### AI

```typescript
const { message, objects } = await channel.prompt('Create three tasks');
const { message } = await channel.prompt('Summarize', { readOnly: true, effort: 'QUICK' });
```

| Option | Description |
|--------|-------------|
| `locations` | Focus on specific objects by location |
| `responseSchema` | Request structured JSON response |
| `effort` | `'QUICK'`, `'STANDARD'`, `'REASONING'`, or `'RESEARCH'` |
| `ephemeral` | Don't record in interaction history |
| `readOnly` | Disable mutation tools |

The AI automatically receives interaction history, recently modified objects, and any objects passed via `locations` as context.

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
await channel.deleteObjects([location])
await channel.undo()   // restores deleted object
await channel.redo()   // deletes again
```

### Metadata

Arbitrary key-value storage on the Space (not visible to AI):

```typescript
await channel.setMetadata('viewport', { zoom: 1.5 })
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

// Delete a conversation by ID
await channel.deleteConversation('old-thread')

// Rename the active conversation
await channel.renameConversation('Research')

// Rename a specific conversation
await channel.conversation('thread-42').rename('Research')
```

### Conversation Handles

For extensions that need multiple independent interaction threads (e.g., chat with multiple threads), use `channel.conversation()` to get a reactive handle scoped to a specific conversation:

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
await thread.createObject('note', { text: 'Hello' });
await thread.setSystemInstruction('Respond in haiku');
await thread.rename('Research Thread');

// Cleanup
thread.close();   // Stop listening for updates
```

Conversations are auto-created on first interaction — no explicit create step needed. All conversations share one bridge connection. The 200-interaction cap applies per conversation.

### Events

```typescript
channel.on('objectCreated', ({ location, object, source }) => { ... })
channel.on('objectUpdated', ({ location, object, source }) => { ... })
channel.on('objectDeleted', ({ location, source }) => { ... })
channel.on('objectMoved',   ({ from, to, object, source }) => { ... })
channel.on('metadataUpdated', ({ metadata, source }) => { ... })
channel.on('schemaUpdated', ({ schema, source }) => { ... })
channel.on('channelUpdated', ({ channelId, source }) => { ... })
channel.on('conversationUpdated', ({ conversationId, channelId, source }) => { ... })
channel.on('reset', ({ source }) => { ... })
channel.on('syncError', (error) => { ... })
```

`source` is `'local_user'`, `'remote_user'`, `'remote_agent'`, or `'system'`.

### Reactive Primitives

#### `channel.watch(options)`

Auto-updating filtered object list:

```svelte
<script>
  const tasks = channel.watch({ collection: 'task' });
</script>

{#each tasks.objects as task (task.location)}
  <div>{task.body.title}</div>
{/each}
```

| State | Description |
|-------|-------------|
| `watch.objects` | `$state<RoolObject[]>` — matching objects |
| `watch.loading` | `$state<boolean>` — loading state |

Methods: `watch.refresh()`, `watch.close()`.

#### `channel.object(location)`

Single reactive object subscription:

```svelte
<script>
  const item = channel.object('/space/note/welcome.json');
</script>

{#if item.data}
  <div>{item.data.body.title}</div>
{/if}
```

| State | Description |
|-------|-------------|
| `object.data` | `$state<RoolObject | undefined>` — object data |
| `object.loading` | `$state<boolean>` — loading state |

Methods: `object.refresh()`, `object.close()`.

## Hosting

Extensions run in a sandboxed iframe (`allow-scripts allow-same-origin`). The host creates the iframe, establishes a postMessage bridge, and proxies all channel operations to a real Rool Space. The extension never authenticates directly — the host handles auth and forwards operations.

The bridge protocol:
1. Extension sends `rool:ready`
2. Host responds with `rool:init` (channel metadata, schema, space info, user identity)
3. Extension calls channel methods → `rool:request` → host executes → `rool:response`
4. Host pushes real-time events → `rool:event` → extension updates reactive state

When creating a bridge host, pass `user` so the extension can display the current user's name. Pass `colorScheme` to set the iframe's initial scheme (defaults to `'light'`), and call `host.setColorScheme(...)` later to push changes:

```typescript
const host = createBridgeHost({
  channel,
  iframe,
  user: { id: currentUser.id, name: currentUser.name, email: currentUser.email },
  colorScheme: 'dark',
});

host.setColorScheme('light');
```

## Preview

`preview` drives a headless browser session loading your extension, useful for visual checks and automation. Sessions are implicit — a daemon is auto-ensured for the extension in the current working directory, with no separate boot step. Run `rool-extension preview --help` for subcommands.

## Exported Types

```typescript
import type {
  ReactiveChannel,
  ReactiveConversationHandle,
  ReactiveObject,
  ReactiveWatch,
  WatchOptions,
  BridgeUser,
  ColorScheme,
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
  MoveObjectOptions,
  ObjectCreatedEvent,
  ObjectUpdatedEvent,
  ObjectDeletedEvent,
  ObjectMovedEvent,
  ChangeSource,
  RoolUserRole,
  LinkAccess,
  ChannelEvents,
} from '@rool-dev/extension';
```

## License

MIT - see [LICENSE](../../LICENSE) for details.
