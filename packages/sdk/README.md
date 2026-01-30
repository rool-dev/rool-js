# Rool SDK

The TypeScript SDK for Rool Spaces, a persistent and collaborative environment for organizing objects and their relationships.

Rool Spaces enables you to build applications where AI operates on a structured world model rather than a text conversation. The context for all AI operations is the full object graph, allowing the system to reason about, update, and expand the state of your application directly.

Use Rool to programmatically instruct agents to generate content, research topics, or reorganize data. The client manages authentication, real-time synchronization, and media storage, supporting both single-user and multi-user workflows.

**Core primitives:**
- **Objects** — Key-value records with any fields you define
- **Relations** — Directional links between objects (e.g., `earth` → `orbits` → `sun`)
- **AI operations** — Create, update, or query objects using natural language and `{{placeholders}}`

See [Patterns & Examples](#patterns--examples) for what you can build.

## Installation

```bash
npm install @rool-dev/sdk
```

## Configuration

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient({
  baseUrl: 'https://api.dev.rool.dev',
});
```

### RoolClientConfig

```typescript
interface RoolClientConfig {
  baseUrl: string;           // Base URL (e.g., 'https://api.dev.rool.dev')
  graphqlUrl?: string;       // Override GraphQL endpoint (default: {baseUrl}/graphql)
  mediaUrl?: string;         // Override media endpoint (default: {baseUrl}/media)
  authUrl?: string;          // Override auth endpoint (default: {baseUrl}/auth)
  authProvider?: AuthProvider; // Optional, defaults to browser auth
}
```

### Base URLs

| Environment | URL |
|-------------|-----|
| Development | `https://api.dev.rool.dev` |
| Production | `https://api.rool.dev` |

## Quick Start

```typescript
import { RoolClient } from '@rool-dev/sdk';

// Create and initialize client
const client = new RoolClient({
  baseUrl: 'https://api.dev.rool.dev',
});

// Process auth callbacks if we are returning from the login page
client.initialize();

if (!await client.isAuthenticated()) {
  client.login('My App');  // Redirects to auth page, shows "Sign in to My App"
}

// Open an existing space
const space = await client.openSpace('abc1234');

// Create a new space
const newSpace = await client.createSpace('My New Space');

// Listen for changes (real-time updates are automatic)
space.on('objectCreated', ({ objectId, object, source }) => {
  console.log('New object:', objectId, object, 'from', source);
});

space.on('linked', ({ sourceId, relation, targetId, source }) => {
  console.log('New link:', sourceId, '->', targetId, `[${relation}]`, 'from', source);
});

// Create objects with AI-generated content.
// Field names are yours to define — only 'id' is reserved.
const { object: sun } = await space.createObject({
  data: {
    type: 'star',
    name: 'Sun',
    mass: '{{mass in solar masses}}',
    radius: '{{radius in km}}',
    temperature: '{{surface temperature}}'
  }
});

const { object: earth } = await space.createObject({
  data: {
    type: 'planet',
    name: 'Earth',
    mass: '{{mass in Earth masses}}',
    radius: '{{radius in km}}',
    orbitalPeriod: '{{orbital period in days}}'
  }
});

// Create an undo checkpoint
await space.checkpoint('before linking');

// Link them together
await space.link(earth.id, 'orbits', sun.id);

await space.undo(); // The link created above is now gone
await space.redo(); // The link is back ...

// Stop receiving events for this space and free resources
space.close();
```

## Core Concepts

### Objects & Relations

**Objects** are plain key-value records. The `id` field is reserved; everything else is application-defined.

```typescript
{ id: 'abc123', type: 'article', title: 'Hello World', status: 'draft' }
```

**Relations** connect objects directionally through named links. Each relation name represents a multi-valued reference set on the source object.

```typescript
await space.link(earth.id, 'orbits', sun.id);
// Reads as: "earth.orbits includes sun"

const orbited = space.getChildren(earth.id, 'orbits');  // [sun] - what earth links TO
const orbiters = space.getParents(sun.id, 'orbits');    // [earth] - what links TO sun
```

Relations are indexed and idempotent — creating the same link twice has no effect.

**Notes:**
- Relation names are application-defined strings
- Relations are not stored in object data fields
- Only relations created via `link()` participate in traversal (`getParents`, `getChildren`) and indexing
- Storing object IDs inside regular object fields is possible, but those references are opaque to the system

### AI Placeholder Pattern

Use `{{description}}` in field values to have AI generate content:

```typescript
// Create with AI-generated content
await space.createObject({
  data: {
    type: 'article',
    headline: '{{catchy headline about coffee}}',
    body: '{{informative paragraph}}'
  },
  prompt: 'Write about specialty coffee brewing'
});

// Update existing content with AI
await space.updateObject('abc123', {
  prompt: 'Make the body shorter and more casual'
});

// Add new AI-generated field to existing object
await space.updateObject('abc123', {
  data: { summary: '{{one-sentence summary}}' }
});
```

When resolving placeholders, the agent has access to the full object data and the surrounding space context (except for `_`-prefixed fields). Placeholders are instructions, not templates, and do not need to repeat information already present in other fields.

Placeholders are resolved by the AI during the mutation and replaced with concrete values. The `{{...}}` syntax is never stored — it only guides the agent while creating or updating the object.

### Checkpoints & Undo/Redo

Undo/redo works on **checkpoints**, not individual operations. Call `checkpoint()` before making changes to create a restore point.

```typescript
// Create a checkpoint before user action
await space.checkpoint('Delete object');
await space.deleteObjects([objectId]);

// User can now undo back to the checkpoint
if (await space.canUndo()) {
  await space.undo(); // Restores the deleted object
}

// Redo reapplies the undone action
if (await space.canRedo()) {
  await space.redo(); // Deletes the object again
}
```

Without a checkpoint, `undo()` has nothing to restore to. Undo always restores the space to the last checkpoint, regardless of how many changes were made since.

In collaborative scenarios, conflicting changes (modified by others since your checkpoint) are silently skipped.

### Hidden Fields

Fields starting with `_` (e.g., `_ui`, `_cache`) are hidden from AI but otherwise behave like normal fields — they sync in real-time, persist to the server, support undo/redo, and are visible to all users of the Space. Use them for UI state, positions, or other data the AI shouldn't see or modify:

```typescript
await space.createObject({
  data: {
    title: 'My Article',
    author: "John Doe",
    _ui: { x: 100, y: 200, collapsed: false }
  }
});
```

### Real-time Sync

Events fire for both local and remote changes. The `source` field indicates origin:

- `local_user` — This client made the change
- `remote_user` — Another user/client made the change
- `remote_agent` — AI agent made the change
- `system` — Resync after error

```typescript
// All UI updates happen in one place, regardless of change source
space.on('objectUpdated', ({ objectId, object, source }) => {
  renderObject(objectId, object);
  if (source === 'remote_agent') {
    doLayout(); // AI might have added content
  }
});

// Caller just makes the change - event handler does the UI work
space.updateObject(objectId, { prompt: 'expand this' });
```

### Custom Object IDs

By default, `createObject` generates a 6-character alphanumeric ID. Provide your own via `data.id`:

```typescript
await space.createObject({ data: { id: 'article-42', title: 'The Meaning of Life' } });
```

**Why use custom IDs?**
- **Fire-and-forget creation** — Know the ID immediately without awaiting the response. You can create an object and link to it in parallel; the sync happens in the background.
- **Meaningful IDs** — Use domain-specific IDs like `user-123` or `doc-abc` for easier debugging and external references.

```typescript
// Fire-and-forget: create and link without waiting
const id = RoolClient.generateId();
space.createObject({ data: { id, type: 'note', text: '{{expand this idea}}' } });
space.link(parentId, 'hasNote', id);  // Can link immediately
```

**Constraints:**
- Must contain only alphanumeric characters, hyphens (`-`), and underscores (`_`)
- Must be unique within the space (throws if ID exists)
- Cannot be changed after creation (immutable)

Use `RoolClient.generateId()` when you need an ID before calling `createObject` but don't need it to be meaningful — it gives you a valid random ID without writing your own generator.

## Authentication

### Browser (Default)

No configuration needed. Uses localStorage for tokens, redirects to login page.

```typescript
const client = new RoolClient({ baseUrl: 'https://api.rool.dev' });
client.initialize(); // Process auth callbacks if this is a callback from the auth page

if (!await client.isAuthenticated()) {
  client.login('My App'); // Redirect to the auth page
}
```

### Node.js

For CLI tools and scripts. Stores credentials in `~/.config/rool/`, opens browser for login.

```typescript
import { NodeAuthProvider } from '@rool-dev/sdk/node';

const client = new RoolClient({
  baseUrl: 'https://api.rool.dev',
  authProvider: new NodeAuthProvider()
});

if (!await client.isAuthenticated()) {
  await client.login('My CLI Tool'); // Open auth page in system browser, await callback
}
```

### Auth Methods

| Method | Description |
|--------|-------------|
| `initialize(): boolean` | **Call on app startup if running in browser.** Processes auth callback from URL, sets up token refresh. |
| `login(appName): void` | Redirect to login page. The app name is displayed on the auth page ("Sign in to {appName}"). |
| `logout(): void` | Clear tokens and state |
| `isAuthenticated(): Promise<boolean>` | Check auth status (validates token) |
| `getToken(): Promise<string \| undefined>` | Get current access token |
| `getAuthUser(): AuthUser` | Get auth identity from JWT (`{ email, name }`) |

## AI Agent

The `prompt()` method is the primary way to invoke the AI agent. The agent has editor-level capabilities — it can create, modify, delete, link, and research — but cannot see or modify `_`-prefixed fields.

```typescript
const { message, objects } = await space.prompt(
  "Create a topic node for the solar system, then child nodes for each planet."
);
console.log(`AI: ${message}`);
console.log(`Modified ${objects.length} objects:`, objects);
```

Use `checkpoint()` before prompting to make operations undoable.

### Method Signature

```typescript
prompt(text: string, options?: PromptOptions): Promise<{ message: string; objects: RoolObject[] }>
```

Returns a message (the AI's response) and the list of objects that were created or modified.

### Options

| Option | Description |
|--------|-------------|
| `objectIds` | Limit context to specific objects |
| `responseSchema` | Request structured JSON instead of text summary |
| `effort` | Effort level: `'QUICK'`, `'STANDARD'` (default), `'REASONING'`, or `'RESEARCH'` |
| `ephemeral` | If true, don't record in conversation history (useful for tab completion) |
| `readOnly` | If true, disable mutation tools (create, update, link, unlink). Use for questions. |

### Effort Levels

| Level | Description |
|-------|-------------|
| `QUICK` | Fast, lightweight model. Best for simple questions. |
| `STANDARD` | Default behavior with balanced capabilities. |
| `REASONING` | Extended reasoning for complex tasks. |
| `RESEARCH` | Pre-analysis and context gathering (reserved for future use). |

### Examples

```typescript
// Reorganize and link existing objects
const { objects } = await space.prompt(
  "Group these notes by topic and create a parent node for each group."
);

// Work with specific objects
const result = await space.prompt(
  "Summarize these articles",
  { objectIds: ['article-1', 'article-2'] }
);

// Quick question without mutations (fast model + read-only)
const { message } = await space.prompt(
  "What topics are covered?",
  { effort: 'QUICK', readOnly: true }
);

// Complex analysis with extended reasoning
await space.prompt(
  "Analyze relationships and reorganize",
  { effort: 'REASONING' }
);
```

### Structured Responses

Use `responseSchema` to get structured JSON instead of a text message:

```typescript
const { message } = await space.prompt("Categorize these items", {
  objectIds: ['item-1', 'item-2', 'item-3'],
  responseSchema: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string' }
      },
      summary: { type: 'string' }
    }
  }
});

const result = JSON.parse(message);
console.log(result.categories, result.summary);
```

### Context Flow

AI operations automatically receive context:
- **Interaction history** — Previous interactions and their results from this conversation
- **Recently modified objects** — Objects created or changed recently
- **Selected objects** — Objects passed via `objectIds` are given primary focus

This context flows automatically — no configuration needed. The AI sees enough history to maintain coherent interactions while respecting the `_`-prefixed field hiding rules.

## Collaboration

### Adding Users to a Space

To add a user to a space, you need their user ID. Use `searchUser()` to find them by email:

```typescript
// Find the user by email
const user = await client.searchUser('colleague@example.com');
if (!user) {
  throw new Error('User not found');
}

// Add them to the space
await space.addUser(user.id, 'editor');
```

### Roles

| Role | Capabilities |
|------|--------------|
| `owner` | Full control, can delete space and manage users |
| `editor` | Can create, modify, delete objects and links |
| `viewer` | Read-only access |

### Space Collaboration Methods

| Method | Description |
|--------|-------------|
| `listUsers(): Promise<SpaceMember[]>` | List users with access |
| `addUser(userId, role): Promise<void>` | Add user to space |
| `removeUser(userId): Promise<void>` | Remove user from space |

### Client User Methods

| Method | Description |
|--------|-------------|
| `getCurrentUser(): Promise<CurrentUser>` | Get current Rool user (id, email, name, plan, credits, createdAt, lastActivity, processedAt, storage) |
| `searchUser(email): Promise<UserResult \| null>` | Find user by exact email address (no partial matching) |

### Real-time Collaboration

When multiple users have a space open, changes sync in real-time. The `source` field in events tells you who made the change:

```typescript
space.on('objectUpdated', ({ objectId, object, source }) => {
  if (source === 'remote_user') {
    // Another user made this change
    showCollaboratorActivity(object);
  }
});
```

See [Real-time Sync](#real-time-sync) for more on event sources.

## RoolClient API

### Space Lifecycle

| Method | Description |
|--------|-------------|
| `listSpaces(): Promise<RoolSpaceInfo[]>` | List available spaces |
| `openSpace(id, options?): Promise<RoolSpace>` | Open a space for editing. Options: `{ conversationId?: string }` |
| `createSpace(name?, options?): Promise<RoolSpace>` | Create a new space. Options: `{ conversationId?: string }` |
| `deleteSpace(id): Promise<void>` | Permanently delete a space (cannot be undone) |

### User Storage

Server-side key-value storage for user preferences, UI state, and other persistent data. Replaces browser localStorage with cross-device, server-synced storage.

**Features:**
- Sync reads from local cache (available immediately, even before auth)
- Automatic sync to server and across tabs/devices via SSE
- `userStorageChanged` event fires on all changes (local or remote)
- Total storage limited to 10MB per user

| Method | Description |
|--------|-------------|
| `getUserStorage<T>(key): T \| undefined` | Get a value (sync, from local cache) |
| `setUserStorage(key, value): void` | Set a value (updates cache, syncs to server) |
| `getAllUserStorage(): Record<string, unknown>` | Get all stored data (sync, from local cache) |

```typescript
// Sync read at startup (before auth completes)
const theme = client.getUserStorage<string>('theme');
applyTheme(theme ?? 'light');

// Write - updates immediately, syncs to server in background
client.setUserStorage('theme', 'dark');
client.setUserStorage('sidebar', { collapsed: true, width: 280 });

// Delete a key
client.setUserStorage('theme', null);

// The cache may be stale from a previous session — listen for updates
// to apply fresh values once sync completes (or when other tabs/devices change values)
client.on('userStorageChanged', ({ key, value, source }) => {
  // source: 'local' (this client) or 'remote' (server/other client)
  if (key === 'theme') applyTheme(value as string);
});
```

### Utilities

| Method | Description |
|--------|-------------|
| `RoolClient.generateId(): string` | Generate 6-char alphanumeric ID (static) |
| `graphql<T>(query, variables?): Promise<T>` | Execute raw GraphQL |
| `destroy(): void` | Clean up resources |

### Client Events

```typescript
client.on('authStateChanged', (authenticated: boolean) => void)
client.on('spaceCreated', (space: RoolSpaceInfo) => void)
client.on('spaceDeleted', (spaceId: string) => void)
client.on('spaceRenamed', (spaceId: string, newName: string) => void)
client.on('userStorageChanged', ({ key, value, source }: UserStorageChangedEvent) => void)
client.on('connectionStateChanged', (state: 'connected' | 'disconnected' | 'reconnecting') => void)
client.on('error', (error: Error, context?: string) => void)
```

## RoolSpace API

Spaces are first-class objects with built-in undo/redo, event emission, and real-time sync.

### Properties

| Property | Description |
|----------|-------------|
| `id: string` | Space ID |
| `name: string` | Space name |
| `role: RoolUserRole` | User's role (`'owner' \| 'editor' \| 'viewer'`) |
| `userId: string` | Current user's ID |
| `conversationId: string` | ID for interaction history (tracks AI context). Writable — set to switch conversations. |
| `isReadOnly(): boolean` | True if viewer role |

### Lifecycle

| Method | Description |
|--------|-------------|
| `close(): void` | Clean up resources and stop receiving updates |
| `rename(newName): Promise<void>` | Rename the space |

### Object Operations

Objects are plain key/value records. `id` is the only reserved field; everything else is application-defined.

| Method | Description |
|--------|-------------|
| `getObject(objectId): Promise<RoolObject \| undefined>` | Get object data, or undefined if not found. |
| `stat(objectId): Promise<RoolObjectStat \| undefined>` | Get object stat (audit info: modifiedAt, modifiedBy, modifiedByName), or undefined if not found. |
| `findObjects(options): Promise<{ objects, message }>` | Find objects using structured filters and natural language. Results sorted by modifiedAt (desc by default). |
| `getObjectIds(options?): string[]` | Get all object IDs. Sorted by modifiedAt (desc by default). Options: `{ limit?, order? }`. |
| `createObject(options): Promise<{ object, message }>` | Create a new object. Returns the object (with AI-filled content) and message. |
| `updateObject(objectId, options): Promise<{ object, message }>` | Update an existing object. Returns the updated object and message. |
| `deleteObjects(objectIds): Promise<void>` | Delete objects. Outbound links are removed automatically. |

#### createObject / updateObject Options

Both methods accept an options object:

| Option | Description |
|--------|-------------|
| `data` | Object data fields (any key-value pairs). Include `id` to use a custom ID (createObject only). Use `{{placeholder}}` for AI-generated content. Using `null`/`undefined` deletes a field. Fields prefixed with `_` are hidden from AI. Required for `createObject`, optional for `updateObject`. |
| `prompt` | Natural language instruction for AI to generate or modify content. |
| `ephemeral` | If true, the operation won't be recorded in conversation history. Useful for transient operations. |

#### findObjects Options

Find objects using structured filters, semantic matching, and natural language. All queries are executed server-side.

| Option | Description |
|--------|-------------|
| `where` | Structured field requirements. Static values = exact match. `{{placeholder}}` values = semantic match by AI. |
| `prompt` | Natural language query for additional filtering. |
| `limit` | Maximum number of results to return. |
| `objectIds` | Scope search to specific objects (like `prompt()`). |
| `order` | Sort order by modifiedAt: `'asc'` or `'desc'` (default: `'desc'`). |
| `ephemeral` | If true, the query won't be recorded in conversation history. Useful for responsive search. |

**Examples:**

```typescript
// Exact field matching (no AI needed)
const { objects } = await space.findObjects({
  where: { type: 'article', status: 'published' }
});

// Pure natural language query (AI interprets)
const { objects, message } = await space.findObjects({
  prompt: 'articles about space exploration published this year'
});

// Semantic field matching with {{...}} placeholders
const { objects } = await space.findObjects({
  where: {
    type: 'product',
    category: '{{something edible}}'  // AI interprets this
  }
});

// Combined: structured + semantic + natural language
const { objects } = await space.findObjects({
  where: {
    type: 'article',
    topic: '{{related to climate}}'
  },
  prompt: 'that discuss solutions positively',
  limit: 10
});
```

The AI has access to the full object graph context (except `_`-prefixed fields) when evaluating queries. The returned `message` explains why objects matched the criteria.

### Relations

| Method | Description |
|--------|-------------|
| `link(sourceId, relation, targetId): Promise<void>` | Add target to the named relation on source. Reads as "source.relation includes target". |
| `unlink(sourceId, relation?, targetId?): Promise<boolean>` | Remove relations. Three forms: `(source, relation, target)` removes one link, `(source, relation)` clears all targets for that relation, `(source)` clears all relations on source. |
| `getParents(objectId, relation?, options?): Promise<RoolObject[]>` | Get objects that link TO this object. Sorted by modifiedAt (desc by default). Options: `{ limit?, order? }`. |
| `getChildren(objectId, relation?, options?): Promise<RoolObject[]>` | Get objects this object links TO. Sorted by modifiedAt (desc by default). Options: `{ limit?, order? }`. |

**Examples:**

```typescript
// Create relations
await space.link(earth.id, 'orbits', sun.id);
await space.link(sun.id, 'hasPlanet', earth.id);

// This reads as:
// "earth.orbits includes sun"
// "sun.hasPlanet includes earth"

// Remove one specific link
await space.unlink(earth.id, 'orbits', sun.id);

// Clear all targets for a relation
await space.unlink(earth.id, 'orbits');

// Clear ALL relations on an object
await space.unlink(earth.id);

// Query relations
const planets = space.getChildren(sun.id, 'hasPlanet');
const stars = space.getParents(earth.id, 'orbits');
```

### Undo/Redo

| Method | Description |
|--------|-------------|
| `checkpoint(label?): Promise<string>` | Call before mutations. Saves current state for undo. |
| `canUndo(): Promise<boolean>` | Check if undo available |
| `canRedo(): Promise<boolean>` | Check if redo available |
| `undo(): Promise<boolean>` | Undo to previous checkpoint |
| `redo(): Promise<boolean>` | Redo undone action |
| `clearHistory(): Promise<void>` | Clear undo/redo stack |

See [Checkpoints & Undo/Redo](#checkpoints--undoredo) for semantics.

### Space Metadata

Store arbitrary data alongside the Space without it being part of the graph content (e.g., viewport state, user preferences).

| Method | Description |
|--------|-------------|
| `setMetadata(key, value): void` | Set space-level metadata |
| `getMetadata(key): unknown` | Get metadata value, or undefined if key not set |
| `getAllMetadata(): Record<string, unknown>` | Get all metadata |

### Media

Media URLs in object fields are visible to AI. Both uploaded and AI-generated media work the same way — use `fetchMedia` to retrieve them for display.

| Method | Description |
|--------|-------------|
| `uploadMedia(file): Promise<string>` | Upload file, returns URL |
| `fetchMedia(url): Promise<MediaResponse>` | Fetch any URL, returns headers and blob() method (adds auth for backend URLs, works for external URLs too) |
| `deleteMedia(url): Promise<void>` | Delete media file by URL |
| `listMedia(): Promise<MediaInfo[]>` | List all media with metadata |

```typescript
// Upload an image
const url = await space.uploadMedia(file);
await space.createObject({ data: { title: 'Photo', image: url } });

// Or let AI generate one using a placeholder
await space.createObject({
  data: { title: 'Mascot', image: '{{generate an image of a flying tortoise}}' }
});

// Display media (handles auth automatically)
const response = await space.fetchMedia(object.image);
if (response.contentType.startsWith('image/')) {
  const blob = await response.blob();
  img.src = URL.createObjectURL(blob);
}
```

### Import/Export

Export space data as JSON-LD for backup, portability, or migration:

| Method | Description |
|--------|-------------|
| `export(): JsonLdDocument` | Export all objects and relations as JSON-LD |
| `import(data): Promise<void>` | Import JSON-LD into empty space |
| `exportArchive(): Promise<Blob>` | Export objects, relations, and media as a zip archive |
| `importArchive(archive): Promise<void>` | Import from a zip archive into empty space |

**Export (data only):**
```typescript
const jsonld = space.export();
const json = JSON.stringify(jsonld, null, 2);
```

**Export (with media):**
```typescript
const archive = await space.exportArchive();
// Save as .zip file
const url = URL.createObjectURL(archive);
```

**Import (data only):**
```typescript
// Space must be empty
const newSpace = await client.createSpace('Imported Data');
await newSpace.import(jsonld);
```

**Import (with media):**
```typescript
// Space must be empty
const newSpace = await client.createSpace('Imported Data');
await newSpace.importArchive(archiveBlob);
```

The JSON-LD format follows W3C standards. The archive format bundles `data.json` (JSON-LD with media URLs rewritten to relative paths) and a `media/` folder containing the actual files. Space metadata and interaction history are not included in either format.

### Space Events

Semantic events describe what changed. Events fire for both local changes and remote changes.

```typescript
// source indicates origin:
// - 'local_user': This client made the change
// - 'remote_user': Another user/client made the change
// - 'remote_agent': AI agent made the change
// - 'system': Resync after error

// Object events
space.on('objectCreated', ({ objectId, object, source }) => void)
space.on('objectUpdated', ({ objectId, object, source }) => void)
space.on('objectDeleted', ({ objectId, source }) => void)

// Link events
space.on('linked', ({ sourceId, relation, targetId, source }) => void)
space.on('unlinked', ({ sourceId, relation, targetId, source }) => void)

// Space metadata
space.on('metadataUpdated', ({ metadata, source }) => void)

// Conversation updated (fetch with getInteractions())
space.on('conversationUpdated', ({ conversationId, source }) => void)

// Full state replacement (undo/redo, resync after error)
space.on('reset', ({ source }) => void)

// ConversationId was changed on the space
space.on('conversationIdChanged', ({ previousConversationId, newConversationId }) => void)

// Sync error occurred, space resynced from server
space.on('syncError', (error: Error) => void)
```

### Error Handling

AI operations may fail due to rate limiting or other transient errors. Check `error.message` for user-friendly error text:

```typescript
try {
  await space.updateObject(objectId, { prompt: 'expand this' });
} catch (error) {
  if (error.message.includes('temporarily unavailable')) {
    showToast('Service busy, please try again in a moment');
  } else {
    showToast(error.message);
  }
}
```

### Internal / Advanced

| Method | Description |
|--------|-------------|
| `getData(): RoolSpaceData` | Get full space data (internal format) |

## Interaction History

Each `RoolSpace` instance has a `conversationId` that tracks interaction history for that space. The history records all meaningful interactions (prompts, object changes, links) as self-contained entries, each capturing the request and its result. History is stored in the space data itself and syncs in real-time to all clients.

### What the AI Receives

AI operations (`prompt`, `createObject`, `updateObject`, `findObjects`) automatically receive:

- **Interaction history** — Previous interactions and their results from this conversation
- **Recently modified objects** — Objects in the space recently created or changed
- **Selected objects** — Objects passed via `objectIds` are given primary focus

This context flows automatically — no configuration needed. The AI sees enough history to maintain coherent interactions while respecting the `_`-prefixed field hiding rules.

### Accessing History

```typescript
// Get interactions for the current conversationId
const interactions = space.getInteractions();
// Returns: Interaction[]

// Get interactions for a specific conversation ID
const interactions = space.getInteractionsById('other-conversation-id');
// Returns: Interaction[]

// List all conversation IDs that have interactions
const conversationIds = space.getConversationIds();
// Returns: string[]
```

### Conversation Access Methods

| Method | Description |
|--------|-------------|
| `getInteractions(): Interaction[]` | Get interactions for the current conversationId |
| `getInteractionsById(id): Interaction[]` | Get interactions for a specific conversation ID |
| `getConversationIds(): string[]` | List all conversation IDs that have conversations |
| `deleteConversation(conversationId?): Promise<void>` | Delete a conversation and its history. Defaults to current conversation. |
| `renameConversation(id, name): Promise<void>` | Rename a conversation. Creates it if it doesn't exist. |
| `listConversations(): Promise<ConversationInfo[]>` | List all conversations with summary info. |

### Listening for Updates

```typescript
space.on('conversationUpdated', ({ conversationId, source }) => {
  // Conversation changed - refresh if needed
  const interactions = space.getInteractions();
  renderInteractions(interactions);
});
```

### Conversation Isolation

By default, each call to `openSpace()` or `createSpace()` generates a new `conversationId`. This means:
- Opening a space twice gives you two independent AI conversation histories
- Closing and reopening a space starts fresh

### Switching Conversations

Set `conversationId` to switch conversations without reopening the space:

```typescript
const space = await client.openSpace('abc123');

// User clicks "Research" thread in sidebar
space.conversationId = 'research-thread';
await space.prompt("Analyze this data");

// User clicks "Main" thread
space.conversationId = 'main-thread';
await space.prompt("Summarize findings");

// Listen for conversation switches
space.on('conversationIdChanged', ({ previousConversationId, newConversationId }) => {
  // Re-render chat UI with new conversation's history
  renderChat(space.getInteractions());
});
```

### Resuming Conversations

Pass a `conversationId` at open time to start with a specific conversation:

```typescript
// Resume a known conversation when opening
const space = await client.openSpace('abc123', { conversationId: 'research-thread' });
```

**Use cases:**
- **Page refresh** — Store `conversationId` in localStorage to maintain context across reloads
- **Multiple conversations** — Switch between different conversation contexts using the setter
- **Collaborative conversations** — Share a `conversationId` between users to enable shared AI conversation history

**Tip:** Use the user's id as `conversationId` to share context across tabs/devices, or a fixed string like `'shared'` to share context across all users.

Note: Interaction history is truncated to the most recent 50 entries to manage space size.

### The ai Field

The `ai` field in interactions distinguishes AI-generated responses from synthetic confirmations:
- `ai: true` — AI processed this operation (prompt, or createObject/updateObject with placeholders)
- `ai: false` — System confirmation only (e.g., "Linked X to Y", "Created object abc123")

### Tool Calls

The `toolCalls` array captures what the AI agent did during execution. Use it to build responsive UIs that show progress while the agent works — the `conversationUpdated` event fires as each tool completes, letting you display status updates or hints in real-time.

## Data Types

### Space Data

```typescript
// RoolObject represents the object data you work with
// Always contains `id`, plus any additional fields
// Fields prefixed with _ are hidden from AI
interface RoolObject {
  id: string;
  [key: string]: unknown;
}

// Object stat - audit information returned by space.stat()
interface RoolObjectStat {
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
}

// Conversation container with metadata
interface Conversation {
  name?: string;                // Conversation name (optional)
  createdAt?: number;           // Timestamp when conversation was created
  interactions: Interaction[];  // Interaction history
}

// Conversation summary info (returned by listConversations)
interface ConversationInfo {
  id: string;
  name: string | null;
  createdAt: number | null;
  interactionCount: number;
}

// Internal space data structure
interface RoolSpaceData {
  version: number;  // Monotonically increasing version for sync consistency
  objects: Record<string, RoolObjectEntry>;
  meta: Record<string, unknown>;  // Space-level metadata
  conversations?: Record<string, Conversation>;  // Conversations keyed by conversationId
}

// Full stored object structure (for advanced use with getData())
interface RoolObjectEntry {
  links: Record<string, string[]>;  // relation -> [targetId1, targetId2, ...]
  data: RoolObject;                 // The actual object data
  modifiedAt: number;               // Timestamp of last modification
  modifiedBy: string;               // User ID who last modified
  modifiedByName: string | null;    // Display name at time of modification
}
```

### Interaction Types

```typescript
interface ToolCall {
  name: string;      // Tool name (e.g., "create_object", "link", "search_web")
  input: unknown;    // Arguments passed to the tool
  result: string;    // Truncated result (max 500 chars)
}

interface Interaction {
  id: string;                    // Unique ID for this interaction
  timestamp: number;
  userId: string;                // Who performed this interaction
  userName?: string | null;      // Display name at time of interaction
  operation: 'prompt' | 'createObject' | 'updateObject' | 'link' | 'unlink' | 'deleteObjects';
  input: string;                 // What the user did: prompt text or action description
  output: string | null;         // Result: AI response or confirmation message (null while in-progress)
  ai: boolean;                   // Whether AI was invoked (vs synthetic confirmation)
  modifiedObjectIds: string[];   // Objects affected by this interaction
  toolCalls: ToolCall[];         // Tools called during this interaction (for AI prompts)
}
```

### Info Types

```typescript
type RoolUserRole = 'owner' | 'editor' | 'viewer';

interface RoolSpaceInfo { id: string; name: string; role: RoolUserRole; ownerId: string; size: number; createdAt: string; updatedAt: string; }
interface SpaceMember { id: string; email: string; role: RoolUserRole; }
interface UserResult { id: string; email: string; name: string | null; }
interface CurrentUser { id: string; email: string; name: string | null; plan: string; creditsBalance: number; createdAt: string; lastActivity: string; processedAt: string; storage: Record<string, unknown>; }
interface MediaInfo { uuid: string; url: string; contentType: string; size: number; createdAt: string; }
interface MediaResponse { contentType: string; size: number | null; blob(): Promise<Blob>; }
type ChangeSource = 'local_user' | 'remote_user' | 'remote_agent' | 'system';
```

### Prompt Options

```typescript
type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';

interface PromptOptions {
  objectIds?: string[];      // Scope to specific objects
  responseSchema?: Record<string, unknown>;
  effort?: PromptEffort;     // Effort level (default: 'STANDARD')
  ephemeral?: boolean;       // Don't record in conversation history
  readOnly?: boolean;        // Disable mutation tools (default: false)
}
```

## Patterns & Examples

A Rool Space is a persistent, shared world model. Applications project different interaction patterns onto the same core primitives:

- **Objects and relations** store durable state
- **Interaction history** tracks what happened (requests, results, modified objects)
- **Events** describe what changed in real-time

Below are a few representative patterns.

### Chat With Generated Artifacts

- **Space**: documents, notes, images, tasks as objects
- **Interaction history**: prompts and AI responses stored in space, synced across clients
- **UI**: renders interactions from `getInteractions()` as chat; derives artifact lists from object events

**Pattern**
- Interaction history syncs in real-time; UI renders entries as chat bubbles
- Artifacts are persistent objects
- Listen to `conversationUpdated` to update chat UI
- Selecting objects defines the AI working set via `objectIds`

### Multi-User World / Text Adventure

- **Space**: rooms, items, NPCs, players as objects
- **Relations**: navigation, containment, location
- **Conversation**: player commands and narrative continuity

**Pattern**
- The space is the shared world state
- Objects can be created dynamically as the world expands
- AI generates descriptions and events using `{{placeholders}}`

### Collaborative Knowledge Graph

- **Space**: concepts, sources, hypotheses as objects
- **Relations**: semantic links between them
- **Conversation**: exploratory analysis and questioning

**Pattern**
- Graph structure lives in relations
- AI operates on selected subgraphs via `objectIds`
- Analysis results are stored; reasoning steps are transient

### Common Design Invariants

- Durable content lives in space objects and relations
- Interaction history lives in space conversations (persistent, synced, truncated to 50 entries)
- UI state lives in the client, space metadata, or `_`-prefixed fields
- AI focus is controlled by object selection, not by replaying history

## License

This client is intended for use with the Rool platform and requires an account. Access is currently by invitation.

Proprietary — © Lightpost One. All rights reserved.
