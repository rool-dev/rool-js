# Rool SDK

The TypeScript SDK for Rool, a persistent and collaborative environment for organizing objects.

> **Building a new Rool app?** Start with [`@rool-dev/app`](/app/) — it handles hosting, dev server, and gives you a reactive Svelte channel out of the box. This SDK is for advanced use cases: integrating Rool into an existing application, building Node.js scripts, or working outside the app sandbox.

Rool enables you to build applications where AI operates on a structured world model rather than a text conversation. The context for all AI operations is the full object graph, allowing the system to reason about, update, and expand the state of your application directly.

Use Rool to programmatically instruct agents to generate content, research topics, or reorganize data. The client manages authentication, real-time synchronization, and media storage, supporting both single-user and multi-user workflows.

**Core primitives:**
- **Spaces** — Containers for objects, schema, metadata, and channels
- **Channels** — Named contexts within a space, each with independent interaction history. All object and AI operations go through a channel.
- **Objects** — Key-value records with any fields you define. References between objects are data fields whose values are object IDs.
- **AI operations** — Create, update, or query objects using natural language and `{{placeholders}}`

See [Patterns & Examples](#patterns--examples) for what you can build.

## Installation

```bash
npm install @rool-dev/sdk
```

## Quick Start

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient();
const authenticated = await client.initialize();

if (!authenticated) {
  client.login('My App');  // Redirects to auth page, shows "Sign in to My App"
}

// Create a new space, then open a channel on it
const space = await client.createSpace('Solar System');
const channel = await space.openChannel('main');

// Define the schema — what types of objects exist and their fields
await channel.createCollection('body', [
  { name: 'name', type: { kind: 'string' } },
  { name: 'mass', type: { kind: 'string' } },
  { name: 'radius', type: { kind: 'string' } },
  { name: 'orbits', type: { kind: 'maybe', inner: { kind: 'ref' } } },
]);

// Create objects with AI-generated content using {{placeholders}}
const { object: sun } = await channel.createObject({
  data: {
    name: 'Sun',
    mass: '{{mass in solar masses}}',
    radius: '{{radius in km}}'
  }
});

const { object: earth } = await channel.createObject({
  data: {
    name: 'Earth',
    mass: '{{mass in Earth masses}}',
    radius: '{{radius in km}}',
    orbits: sun.id  // Reference to the sun object
  }
});

// Use the AI agent to work with your data
const { message, objects } = await channel.prompt(
  'Add the other planets in our solar system, each referencing the Sun'
);
console.log(message);  // AI explains what it did
console.log(`Created ${objects.length} objects`);

// Query with natural language
const { objects: innerPlanets } = await channel.findObjects({
  prompt: 'planets closer to the sun than Earth'
});

// Clean up
channel.close();
```

## Core Concepts

### Spaces and Channels

A **space** is a container that holds objects, schema, metadata, and channels. A **channel** is a named context within a space — it's the handle you use for all object and AI operations. Each channel has its own interaction history.

There are two main handles:
- **`RoolSpace`** — Lightweight admin handle for user management, link access, channel management, and export. No real-time subscription.
- **`RoolChannel`** — Full real-time handle for objects, AI prompts, media, schema, and undo/redo.

```typescript
// Open a space for admin operations
const space = await client.openSpace('space-id');
await space.addUser(userId, 'editor');
await space.setLinkAccess('viewer');

// Open a channel for object and AI operations
const channel = await client.openChannel('space-id', 'my-channel');
await channel.prompt('Create some planets');

// Or open a channel via the space handle
const channel2 = await space.openChannel('research');
await channel2.prompt('Analyze the data');  // Independent channel
```

The `channelId` is fixed when you open a channel and cannot be changed. To use a different channel, open a new one. Both channels share the same objects and schema — only the interaction history differs.

**Channel ID constraints:**
- 1–32 characters
- Only alphanumeric characters, hyphens (`-`), and underscores (`_`)

### Objects & References

**Objects** are plain key-value records. The `id` field is reserved; everything else is application-defined.

```typescript
{ id: 'abc123', title: 'Hello World', status: 'draft' }
```

**References** between objects are data fields whose values are object IDs. The system detects these statistically — any string field whose value matches an existing object ID is recognized as a reference.

```typescript
// A planet references a star via the 'orbits' field
{ id: 'earth', name: 'Earth', orbits: 'sun-01' }

// An array of references
{ id: 'team-a', name: 'Alpha', members: ['user-1', 'user-2', 'user-3'] }
```

References are just data — no special API is needed to create or remove them. Set a field to an object ID to create a reference; clear it to remove it.

### AI Placeholder Pattern

Use `{{description}}` in field values to have AI generate content:

```typescript
// Create with AI-generated content
await channel.createObject({
  data: {
    headline: '{{catchy headline about coffee}}',
    body: '{{informative paragraph}}'
  }
});

// Update existing content with AI
await channel.updateObject('abc123', {
  prompt: 'Make the body shorter and more casual'
});

// Add new AI-generated field to existing object
await channel.updateObject('abc123', {
  data: { summary: '{{one-sentence summary}}' }
});
```

When resolving placeholders, the agent has access to the full object data and the surrounding space context (except for `_`-prefixed fields). Placeholders are instructions, not templates, and do not need to repeat information already present in other fields.

Placeholders are resolved by the AI during the mutation and replaced with concrete values. The `{{...}}` syntax is never stored — it only guides the agent while creating or updating the object.

### Checkpoints & Undo/Redo

Undo/redo works on **checkpoints**, not individual operations. Call `checkpoint()` before making changes to create a restore point.

```typescript
// Create a checkpoint before user action
await channel.checkpoint('Delete object');
await channel.deleteObjects([objectId]);

// User can now undo back to the checkpoint
if (await channel.canUndo()) {
  await channel.undo(); // Restores the deleted object
}

// Redo reapplies the undone action
if (await channel.canRedo()) {
  await channel.redo(); // Deletes the object again
}
```

Without a checkpoint, `undo()` has nothing to restore to. Undo always restores the space to the last checkpoint, regardless of how many changes were made since.

In collaborative scenarios, conflicting changes (modified by others since your checkpoint) are silently skipped.

### Hidden Fields

Fields starting with `_` (e.g., `_ui`, `_cache`) are hidden from AI and ignored by the schema — you can add them to any object regardless of its collection definition. Otherwise they behave like normal fields: they sync in real-time, persist to the server, support undo/redo, and are visible to all users of the Space. Use them for UI state, positions, or other data the AI shouldn't see or modify:

```typescript
await channel.createObject({
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
channel.on('objectUpdated', ({ objectId, object, source }) => {
  renderObject(objectId, object);
  if (source === 'remote_agent') {
    doLayout(); // AI might have added content
  }
});

// Caller just makes the change - event handler does the UI work
channel.updateObject(objectId, { prompt: 'expand this' });
```

### Custom Object IDs

By default, `createObject` generates a 6-character alphanumeric ID. Provide your own via `data.id`:

```typescript
await channel.createObject({ data: { id: 'article-42', title: 'The Meaning of Life' } });
```

**Why use custom IDs?**
- **Fire-and-forget creation** — Know the ID immediately without awaiting the response.
- **Meaningful IDs** — Use domain-specific IDs like `user-123` or `doc-abc` for easier debugging and external references.

```typescript
// Fire-and-forget: create and reference without waiting
const id = RoolClient.generateId();
channel.createObject({ data: { id, text: '{{expand this idea}}' } });
channel.updateObject(parentId, { data: { notes: [...existingNotes, id] } }); // Add reference immediately
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
const client = new RoolClient();
const authenticated = await client.initialize();

if (!authenticated) {
  client.login('My App'); // Redirect to the auth page
}
```

### Node.js

For CLI tools and scripts. Stores credentials in `~/.config/rool/`, opens browser for login.

```typescript
import { NodeAuthProvider } from '@rool-dev/sdk/node';

const client = new RoolClient({ authProvider: new NodeAuthProvider() });
const authenticated = await client.initialize();

if (!authenticated) {
  await client.login('My CLI Tool'); // Opens browser, waits for callback
}
```

### Auth Methods

| Method | Description |
|--------|-------------|
| `initialize(): Promise<boolean>` | **Call on app startup.** Processes auth callback from URL, sets up token refresh, returns auth state. |
| `login(appName): void` | Redirect to login page. The app name is displayed on the auth page ("Sign in to {appName}"). |
| `logout(): void` | Clear tokens and state |
| `isAuthenticated(): Promise<boolean>` | Check auth status (validates token) |
| `getAuthUser(): AuthUser` | Get auth identity from JWT (`{ email, name }`) |

## AI Agent

The `prompt()` method is the primary way to invoke the AI agent. The agent has editor-level capabilities — it can create, modify, and delete objects — but cannot see or modify `_`-prefixed fields.

```typescript
const { message, objects } = await channel.prompt(
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
| `objectIds` | Focus the AI on specific objects (given primary attention in context) |
| `responseSchema` | Request structured JSON instead of text summary |
| `effort` | Effort level: `'QUICK'`, `'STANDARD'` (default), `'REASONING'`, or `'RESEARCH'` |
| `ephemeral` | If true, don't record in interaction history (useful for tab completion) |
| `readOnly` | If true, disable mutation tools (create, update, delete). Use for questions. |
| `attachments` | Files to attach (`File`, `Blob`, or `{ data, contentType }`). Uploaded to the media store via `uploadMedia()`. Resulting URLs are stored on the interaction's `attachments` field for UI rendering. The AI can interpret images (JPEG, PNG, GIF, WebP, SVG), PDFs, text-based files (plain text, Markdown, CSV, HTML, XML, JSON), and DOCX documents. Other file types are uploaded and stored but the AI cannot read their contents. |

### Effort Levels

| Level | Description |
|-------|-------------|
| `QUICK` | Fast, lightweight model. Best for simple questions. |
| `STANDARD` | Default behavior with balanced capabilities. |
| `REASONING` | Extended reasoning for complex tasks. |
| `RESEARCH` | Most thorough mode with deep analysis. Slowest and most credit-intensive. |

### Examples

```typescript
// Reorganize existing objects
const { objects } = await channel.prompt(
  "Group these notes by topic and create a parent node for each group."
);

// Work with specific objects
const result = await channel.prompt(
  "Summarize these articles",
  { objectIds: ['article-1', 'article-2'] }
);

// Quick question without mutations (fast model + read-only)
const { message } = await channel.prompt(
  "What topics are covered?",
  { effort: 'QUICK', readOnly: true }
);

// Complex analysis with extended reasoning
await channel.prompt(
  "Analyze relationships and reorganize",
  { effort: 'REASONING' }
);

// Attach files for the AI to see (File from <input>, Blob, or base64)
const file = fileInput.files[0]; // from <input type="file">
await channel.prompt(
  "Describe what's in this photo and create an object for it",
  { attachments: [file] }
);
```

### Structured Responses

Use `responseSchema` to get structured JSON instead of a text message:

```typescript
const { message } = await channel.prompt("Categorize these items", {
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
- **Interaction history** — Previous interactions and their results from this channel
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
const space = await client.openSpace('space-id');
await space.addUser(user.id, 'editor');
```

### Roles

| Role | Capabilities |
|------|--------------|
| `owner` | Full control, can delete space and manage all users |
| `admin` | All editor capabilities, plus can manage users (except other admins/owners) |
| `editor` | Can create, modify, and delete objects |
| `viewer` | Read-only access (can query with `prompt` and `findObjects`) |

### Space Collaboration Methods

These methods are available on `RoolSpace`:

| Method | Description |
|--------|-------------|
| `listUsers(): Promise<SpaceMember[]>` | List users with access |
| `addUser(userId, role): Promise<void>` | Add user to space (requires owner or admin role) |
| `removeUser(userId): Promise<void>` | Remove user from space (requires owner or admin role) |
| `setLinkAccess(linkAccess): Promise<void>` | Set URL sharing level (requires owner or admin role) |

### URL Sharing

Enable public URL access to allow anyone with the space URL to access it:

```typescript
const space = await client.openSpace('space-id');

// Allow anyone with the URL to view
await space.setLinkAccess('viewer');

// Allow anyone with the URL to edit
await space.setLinkAccess('editor');

// Disable URL access (default)
await space.setLinkAccess('none');

// Check current setting
console.log(space.linkAccess); // 'none' | 'viewer' | 'editor'
```

When a user accesses a space via URL, they're granted the corresponding role (`viewer` or `editor`) based on the space's `linkAccess` setting.

### Client User Methods

| Method | Description |
|--------|-------------|
| `currentUser: CurrentUser \| null` | Cached user profile from `initialize()`. Use for sync access to user info (id, email, name, etc.). Returns `null` before init or if not authenticated. |
| `getCurrentUser(): Promise<CurrentUser>` | Fetch fresh user profile from server (id, email, name, slug, plan, creditsBalance, totalCreditsUsed, createdAt, lastActivity, processedAt, storage) |
| `searchUser(email): Promise<UserResult \| null>` | Find user by exact email address (no partial matching) |

### Real-time Collaboration

When multiple users have a space open, changes sync in real-time. The `source` field in events tells you who made the change:

```typescript
channel.on('objectUpdated', ({ objectId, object, source }) => {
  if (source === 'remote_user') {
    // Another user made this change
    showCollaboratorActivity(object);
  }
});
```

See [Real-time Sync](#real-time-sync) for more on event sources.

## RoolClient API

### Logging

By default the SDK logs errors to the console. Pass a `logger` to see more or customize output:

```typescript
// Default — errors only
const client = new RoolClient();

// Log everything to console
const client = new RoolClient({ logger: console });

// Bring your own logger (pino, winston, etc.)
const client = new RoolClient({
  logger: myLogger // any object with { debug, info, warn, error }
});
```

### Space & Channel Lifecycle

| Method | Description |
|--------|-------------|
| `listSpaces(): Promise<RoolSpaceInfo[]>` | List available spaces |
| `openSpace(spaceId): Promise<RoolSpace>` | Open a space for admin operations (no real-time subscription) |
| `openChannel(spaceId, channelId): Promise<RoolChannel>` | Open a channel on a space |
| `createSpace(name): Promise<RoolSpace>` | Create a new space, returns admin handle |
| `deleteSpace(id): Promise<void>` | Permanently delete a space (cannot be undone) |
| `importArchive(name, archive): Promise<RoolSpace>` | Import from a zip archive, creating a new space |

### Channel Management

Manage channels within a space. Available on both the client and space handles:

| Method | Description |
|--------|-------------|
| `client.renameChannel(spaceId, channelId, name): Promise<void>` | Rename a channel |
| `client.deleteChannel(spaceId, channelId): Promise<void>` | Delete a channel and its interaction history |
| `space.getChannels(): ChannelInfo[]` | List channels (from cached snapshot) |
| `space.deleteChannel(channelId): Promise<void>` | Delete a channel |
| `channel.rename(name): Promise<void>` | Rename the current channel |

### User Storage

Server-side key-value storage for user preferences, UI state, and other persistent data. Replaces browser localStorage with cross-device, server-synced storage.

**Features:**
- Fresh data fetched from server on `initialize()` — cache is authoritative after init
- Sync reads from local cache (fast, no network round-trip)
- Automatic sync to server and across tabs/devices via SSE
- `userStorageChanged` event fires on all changes (local or remote)
- Total storage limited to 10MB per user

| Method | Description |
|--------|-------------|
| `getUserStorage<T>(key): T \| undefined` | Get a value (sync, from cache) |
| `setUserStorage(key, value): void` | Set a value (updates cache, syncs to server) |
| `getAllUserStorage(): Record<string, unknown>` | Get all stored data (sync, from cache) |

```typescript
// After initialize(), storage is fresh from server
const authenticated = await client.initialize();

// Sync reads are now trustworthy
const theme = client.getUserStorage<string>('theme');
applyTheme(theme ?? 'light');

// Write - updates immediately, syncs to server in background
client.setUserStorage('theme', 'dark');
client.setUserStorage('sidebar', { collapsed: true, width: 280 });

// Delete a key
client.setUserStorage('theme', null);

// Listen for changes from other tabs/devices
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
| `fetch(path, init?): Promise<Response>` | Authenticated fetch to the Rool API (adds Bearer token) |
| `destroy(): void` | Clean up resources |

### Client Events

```typescript
client.on('authStateChanged', (authenticated: boolean) => void)
client.on('spaceAdded', (space: RoolSpaceInfo) => void)      // Space created or access granted
client.on('spaceRemoved', (spaceId: string) => void)         // Space deleted or access revoked
client.on('spaceRenamed', (spaceId: string, newName: string) => void)
client.on('channelCreated', (spaceId: string, channel: ChannelInfo) => void)
client.on('channelRenamed', (spaceId: string, channelId: string, newName: string) => void)
client.on('channelDeleted', (spaceId: string, channelId: string) => void)
client.on('userStorageChanged', ({ key, value, source }: UserStorageChangedEvent) => void)
client.on('connectionStateChanged', (state: 'connected' | 'disconnected' | 'reconnecting') => void)
client.on('error', (error: Error, context?: string) => void)
```

**Space list management pattern:**
```typescript
const spaces = new Map<string, RoolSpaceInfo>();

client.on('spaceAdded', (space) => spaces.set(space.id, space));
client.on('spaceRemoved', (id) => spaces.delete(id));
client.on('spaceRenamed', (id, name) => {
  const space = spaces.get(id);
  if (space) spaces.set(id, { ...space, name });
});
```

## RoolSpace API

A space is a lightweight admin handle for space-level operations. It does not have a real-time subscription — use channels for live data and object operations.

### Properties

| Property | Description |
|----------|-------------|
| `id: string` | Space ID |
| `name: string` | Space name |
| `role: RoolUserRole` | User's role |
| `linkAccess: LinkAccess` | URL sharing level |

### Methods

| Method | Description |
|--------|-------------|
| `openChannel(channelId): Promise<RoolChannel>` | Open a channel on this space |
| `rename(newName): Promise<void>` | Rename this space |
| `delete(): Promise<void>` | Permanently delete this space |
| `listUsers(): Promise<SpaceMember[]>` | List users with access |
| `addUser(userId, role): Promise<void>` | Add user to space |
| `removeUser(userId): Promise<void>` | Remove user from space |
| `setLinkAccess(linkAccess): Promise<void>` | Set URL sharing level |
| `getChannels(): ChannelInfo[]` | List channels (from cached snapshot) |
| `deleteChannel(channelId): Promise<void>` | Delete a channel |
| `exportArchive(): Promise<Blob>` | Export space as zip archive |
| `refresh(): Promise<void>` | Refresh space data from server |

## RoolChannel API

A channel is a named context within a space. All object operations, AI prompts, and real-time sync go through a channel. The `channelId` is fixed at open time — to use a different channel, open a new one.

### Properties

| Property | Description |
|----------|-------------|
| `id: string` | Space ID |
| `name: string` | Space name |
| `role: RoolUserRole` | User's role (`'owner' \| 'admin' \| 'editor' \| 'viewer'`) |
| `linkAccess: LinkAccess` | URL sharing level (`'none' \| 'viewer' \| 'editor'`) |
| `userId: string` | Current user's ID |
| `channelId: string` | Channel ID (read-only, fixed at open time) |
| `isReadOnly: boolean` | True if viewer role |

### Lifecycle

| Method | Description |
|--------|-------------|
| `close(): void` | Clean up resources and stop receiving updates |
| `rename(name): Promise<void>` | Rename this channel |

### Object Operations

Objects are plain key/value records. `id` is the only reserved field; everything else is application-defined. References between objects are data fields whose values are object IDs. All objects must belong to a collection (see below in the schema section). Before adding a new type of object, update the schema in the space.

| Method | Description |
|--------|-------------|
| `getObject(objectId): Promise<RoolObject \| undefined>` | Get object data, or undefined if not found. |
| `stat(objectId): RoolObjectStat \| undefined` | Get object stat (audit info: modifiedAt, modifiedBy, modifiedByName), or undefined if not found. Sync read from local cache. |
| `findObjects(options): Promise<{ objects, message }>` | Find objects using structured filters and natural language. Results sorted by modifiedAt (desc by default). |
| `getObjectIds(options?): string[]` | Get all object IDs. Sorted by modifiedAt (desc by default). Options: `{ limit?, order? }`. |
| `createObject(options): Promise<{ object, message }>` | Create a new object. Returns the object (with AI-filled content) and message. |
| `updateObject(objectId, options): Promise<{ object, message }>` | Update an existing object. Returns the updated object and message. |
| `deleteObjects(objectIds): Promise<void>` | Delete objects. Other objects referencing deleted objects retain stale ref values. |

#### createObject Options

| Option | Description |
|--------|-------------|
| `data` | Object data fields (required). Include `id` to use a custom ID. Use `{{placeholder}}` for AI-generated content. Fields prefixed with `_` are hidden from AI. |
| `ephemeral` | If true, the operation won't be recorded in interaction history. Useful for transient operations. |

#### updateObject Options

| Option | Description |
|--------|-------------|
| `data` | Fields to add or update. Pass `null`/`undefined` to delete a field. Use `{{placeholder}}` for AI-generated content. Fields prefixed with `_` are hidden from AI. |
| `prompt` | Natural language instruction for AI to modify content. |
| `ephemeral` | If true, the operation won't be recorded in interaction history. Useful for transient operations. |

#### findObjects Options

Find objects using structured filters and/or natural language.

- **`where` only** — exact-match filtering, no AI, no credits.
- **`collection` only** — filter by collection name (shape-based matching), no AI, no credits.
- **`prompt` only** — AI-powered semantic query over all objects.
- **`where` + `prompt`** — `where` (and `objectIds`) narrow the data set first, then the AI queries within the constrained set.

| Option | Description |
|--------|-------------|
| `where` | Exact-match field filter (e.g. `{ status: 'published' }`). Values must match literally — no operators or `{{placeholders}}`. When combined with `prompt`, constrains which objects the AI can see. |
| `collection` | Filter by collection name. Only returns objects whose shape matches the named collection. |
| `prompt` | Natural language query. Triggers AI evaluation (uses credits). |
| `limit` | Maximum number of results. |
| `objectIds` | Scope to specific object IDs. Constrains the candidate set in both structured and AI queries. |
| `order` | Sort order by modifiedAt: `'asc'` or `'desc'` (default: `'desc'`). |
| `ephemeral` | If true, the query won't be recorded in interaction history. Useful for responsive search. |

**Examples:**

```typescript
// Filter by collection (no AI, no credits)
const { objects } = await channel.findObjects({
  collection: 'article'
});

// Exact field matching (no AI, no credits)
const { objects } = await channel.findObjects({
  where: { status: 'published' }
});

// Combine collection and field filters
const { objects } = await channel.findObjects({
  collection: 'article',
  where: { status: 'published' }
});

// Pure natural language query (AI interprets)
const { objects, message } = await channel.findObjects({
  prompt: 'articles about space exploration published this year'
});

// Combined: collection + where narrow the data, prompt queries within it
const { objects } = await channel.findObjects({
  collection: 'article',
  prompt: 'that discuss climate solutions positively',
  limit: 10
});
```

When `where` or `objectIds` are provided with a `prompt`, the AI only sees the filtered subset — not the full space. The returned `message` explains the query result.

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

Store arbitrary data alongside the Space without it being part of the object data (e.g., viewport state, user preferences).

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
| `fetchMedia(url, options?): Promise<MediaResponse>` | Fetch any URL, returns headers and blob() method (adds auth for backend URLs, works for external URLs too). Pass `{ forceProxy: true }` to skip the direct fetch and route through the server proxy immediately. |
| `deleteMedia(url): Promise<void>` | Delete media file by URL |
| `listMedia(): Promise<MediaInfo[]>` | List all media with metadata |

```typescript
// Upload an image
const url = await channel.uploadMedia(file);
await channel.createObject({ data: { title: 'Photo', image: url } });

// Or let AI generate one using a placeholder
await channel.createObject({
  data: { title: 'Mascot', image: '{{generate an image of a flying tortoise}}' }
});

// Display media (handles auth automatically)
const response = await channel.fetchMedia(object.image);
if (response.contentType.startsWith('image/')) {
  const blob = await response.blob();
  img.src = URL.createObjectURL(blob);
}
```

### Collection Schema

Collections are types you can use to group objects in a space. Every object must belong to a collection. Collections make up the schema and are stored in the space data, syncing in real time together with the rest of the space. The schema is also visible to the AI agent, which it can use to understand what collections exist and what fields they contain, producing more consistent objects.


```typescript
// Define a collection with typed fields
await channel.createCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'enum', values: ['draft', 'published', 'archived'] } },
  { name: 'tags', type: { kind: 'array', inner: { kind: 'string' } } },
  { name: 'author', type: { kind: 'ref' } },
]);

// Read the current schema
const schema = channel.getSchema();
console.log(schema.article.fields); // FieldDef[]

// Modify an existing collection's fields
await channel.alterCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'enum', values: ['draft', 'review', 'published', 'archived'] } },
  { name: 'tags', type: { kind: 'array', inner: { kind: 'string' } } },
  { name: 'author', type: { kind: 'ref' } },
  { name: 'wordCount', type: { kind: 'number' } },
]);

// Remove a collection
await channel.dropCollection('article');
```

| Method | Description |
|--------|-------------|
| `getSchema(): SpaceSchema` | Get all collection definitions |
| `createCollection(name, fields): Promise<CollectionDef>` | Add a new collection to the schema |
| `alterCollection(name, fields): Promise<CollectionDef>` | Replace a collection's field definitions |
| `dropCollection(name): Promise<void>` | Remove a collection from the schema |

#### Field Types

| Kind | Description | Example |
|------|-------------|---------|
| `string` | Text value | `{ kind: 'string' }` |
| `number` | Numeric value | `{ kind: 'number' }` |
| `boolean` | True/false | `{ kind: 'boolean' }` |
| `ref` | Reference to another object | `{ kind: 'ref' }` |
| `enum` | One of a set of values | `{ kind: 'enum', values: ['a', 'b'] }` |
| `literal` | Exact value | `{ kind: 'literal', value: 'fixed' }` |
| `array` | List of values | `{ kind: 'array', inner: { kind: 'string' } }` |
| `maybe` | Optional (nullable) | `{ kind: 'maybe', inner: { kind: 'number' } }` |

### Import/Export

Export and import space data as zip archives for backup, portability, or migration:

| Method | Description |
|--------|-------------|
| `space.exportArchive(): Promise<Blob>` | Export objects, metadata, channels, and media as a zip archive |
| `client.importArchive(name, archive): Promise<RoolSpace>` | Import from a zip archive, creating a new space |

**Export:**
```typescript
const space = await client.openSpace('space-id');
const archive = await space.exportArchive();
// Save as .zip file
const url = URL.createObjectURL(archive);
```

**Import:**
```typescript
const space = await client.importArchive('Imported Data', archiveBlob);
const channel = await space.openChannel('main');
```

The archive format bundles `data.json` (with objects, metadata, and channels) and a `media/` folder containing all media files. Media URLs are rewritten to relative paths within the archive and restored on import.

### Channel Events

Semantic events describe what changed. Events fire for both local changes and remote changes.

```typescript
// source indicates origin:
// - 'local_user': This client made the change
// - 'remote_user': Another user/client made the change
// - 'remote_agent': AI agent made the change
// - 'system': Resync after error

// Object events
channel.on('objectCreated', ({ objectId, object, source }) => void)
channel.on('objectUpdated', ({ objectId, object, source }) => void)
channel.on('objectDeleted', ({ objectId, source }) => void)

// Space metadata
channel.on('metadataUpdated', ({ metadata, source }) => void)

// Channel updated (fetch with getInteractions())
channel.on('channelUpdated', ({ channelId, source }) => void)

// Full state replacement (undo/redo, resync after error)
channel.on('reset', ({ source }) => void)

// Sync error occurred, channel resynced from server
channel.on('syncError', (error: Error) => void)
```

### Error Handling

AI operations may fail due to rate limiting or other transient errors. Check `error.message` for user-friendly error text:

```typescript
try {
  await channel.updateObject(objectId, { prompt: 'expand this' });
} catch (error) {
  if (error.message.includes('temporarily unavailable')) {
    showToast('Service busy, please try again in a moment');
  } else {
    showToast(error.message);
  }
}
```

## Interaction History

Each channel has a `channelId` that identifies it. The history records all meaningful interactions (prompts, object mutations) as self-contained entries, each capturing the request and its result. History is stored in the space data itself and syncs in real-time to all clients.

### What the AI Receives

AI operations (`prompt`, `createObject`, `updateObject`, `findObjects`) automatically receive:

- **Interaction history** — Previous interactions and their results from this channel
- **Recently modified objects** — Objects in the space recently created or changed
- **Selected objects** — Objects passed via `objectIds` are given primary focus

This context flows automatically — no configuration needed. The AI sees enough history to maintain coherent interactions while respecting the `_`-prefixed field hiding rules.

### Accessing History

```typescript
// Get interactions for this channel
const interactions = channel.getInteractions();
// Returns: Interaction[]
```

### Channel History Methods

| Method | Description |
|--------|-------------|
| `getInteractions(): Interaction[]` | Get interactions for this channel |
| `getSystemInstruction(): string \| undefined` | Get system instruction for this channel |
| `setSystemInstruction(instruction): Promise<void>` | Set system instruction for this channel. Pass `null` to clear. |

Channel management (listing, renaming, deleting channels) is done via the client — see [Channel Management](#channel-management).

### System Instructions

System instructions customize how the AI behaves within a channel. The instruction persists across all prompts in that channel.

```typescript
// Make the AI behave like an SQL interpreter
await channel.setSystemInstruction(
  'Behave like an intelligent SQL interpreter. Respond with simple markdown tables. ' +
  'Translate the objects in the space to the implied structure in your responses.'
);

// Now prompts are interpreted as SQL-like queries
const { message } = await channel.prompt('SELECT task, due_date FROM tasks ORDER BY due_date');
// Returns a markdown table of tasks, even if no "tasks" objects exist -
// the AI infers actual tasks from the space content

// Clear the instruction to return to default behavior
await channel.setSystemInstruction(null);
```

System instructions are useful for:
- Defining response formats (tables, JSON, specific templates)
- Setting a persona or expertise area
- Constraining the AI to specific operations
- Creating domain-specific interfaces over your space data

### Listening for Updates

```typescript
channel.on('channelUpdated', ({ channelId, source }) => {
  // Channel updated - refresh if needed
  const interactions = channel.getInteractions();
  renderInteractions(interactions);
});
```

### Multiple Channels

Each channel has its own interaction history. To work with multiple independent histories on the same space, open multiple channels:

```typescript
// Open two channels on the same space
const research = await client.openChannel('space-id', 'research');
const main = await client.openChannel('space-id', 'main');

// Each has independent history
await research.prompt("Analyze this data");
await main.prompt("Summarize findings");

// Close when done
research.close();
main.close();
```

**Use cases:**
- **Chat app with sidebar** — Each sidebar entry is a channel with a different channelId
- **Page refresh** — Store the channelId in localStorage to resume the same channel
- **Collaborative channels** — Share a channelId between users to enable shared AI interaction history

**Tip:** Use the user's id as channelId to share context across tabs/devices, or a fixed string like `'shared'` to share context across all users.

Note: Interaction history is truncated to the most recent 50 entries to manage space size.

### The ai Field

The `ai` field in interactions distinguishes AI-generated responses from synthetic confirmations:
- `ai: true` — AI processed this operation (prompt, or createObject/updateObject with placeholders)
- `ai: false` — System confirmation only (e.g., "Created object abc123")

### Tool Calls

The `toolCalls` array captures what the AI agent did during execution. Use it to build responsive UIs that show progress while the agent works — the `channelUpdated` event fires as each tool completes, letting you display status updates or hints in real-time.

## Data Types

### Schema Types

```typescript
// Allowed field types
type FieldType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'array'; inner?: FieldType }
  | { kind: 'maybe'; inner: FieldType }
  | { kind: 'enum'; values: string[] }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'ref' };

interface FieldDef {
  name: string;
  type: FieldType;
}

interface CollectionDef {
  fields: FieldDef[];
}

// Full schema — collection names to definitions
type SpaceSchema = Record<string, CollectionDef>;
```

### Object Data

```typescript
// RoolObject represents the object data you work with
// Always contains `id`, plus any additional fields
// Fields prefixed with _ are hidden from AI
// References between objects are fields whose values are object IDs
interface RoolObject {
  id: string;
  [key: string]: unknown;
}

// Object stat - audit information returned by channel.stat()
interface RoolObjectStat {
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
}
```

### Channels

```typescript
// Channel container with metadata
interface Channel {
  name?: string;                // Channel name (optional)
  createdAt: number;            // Timestamp when channel was created
  createdBy: string;            // User ID who created the channel
  createdByName?: string;       // Display name at time of creation
  systemInstruction?: string;   // Custom system instruction for AI
  interactions: Interaction[];  // Interaction history
}

// Channel summary info (returned by client.getChannels)
interface ChannelInfo {
  id: string;
  name: string | null;
  createdAt: number;
  createdBy: string;
  createdByName: string | null;
  interactionCount: number;
}
```

Note: `Channel` and `ChannelInfo` are data types describing the stored channel metadata. The `Channel` interface is the wire format; `RoolChannel` is the live SDK class you interact with.

### Interaction Types

```typescript
interface ToolCall {
  name: string;      // Tool name (e.g., "create_object", "update_object", "search_web")
  input: unknown;    // Arguments passed to the tool
  result: string;    // Truncated result (max 500 chars)
}

interface Interaction {
  id: string;                    // Unique ID for this interaction
  timestamp: number;
  userId: string;                // Who performed this interaction
  userName?: string | null;      // Display name at time of interaction
  operation: 'prompt' | 'createObject' | 'updateObject' | 'deleteObjects';
  input: string;                 // What the user did: prompt text or action description
  output: string | null;         // Result: AI response or confirmation message (null while in-progress)
  ai: boolean;                   // Whether AI was invoked (vs synthetic confirmation)
  modifiedObjectIds: string[];   // Objects affected by this interaction
  toolCalls: ToolCall[];         // Tools called during this interaction (for AI prompts)
  attachments?: string[];        // Media URLs attached by the user (images, documents, etc.)
}
```

### Info Types

```typescript
type RoolUserRole = 'owner' | 'admin' | 'editor' | 'viewer';
type LinkAccess = 'none' | 'viewer' | 'editor';

interface RoolSpaceInfo { id: string; name: string; role: RoolUserRole; ownerId: string; size: number; createdAt: string; updatedAt: string; linkAccess: LinkAccess; }
interface SpaceMember { id: string; email: string; role: RoolUserRole; }
interface UserResult { id: string; email: string; name: string | null; }
interface CurrentUser { id: string; email: string; name: string | null; slug: string; plan: string; creditsBalance: number; totalCreditsUsed: number; createdAt: string; lastActivity: string; processedAt: string; storage: Record<string, unknown>; }
interface MediaInfo { url: string; contentType: string; size: number; createdAt: string; }
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
  ephemeral?: boolean;       // Don't record in interaction history
  readOnly?: boolean;        // Disable mutation tools (default: false)
  attachments?: Array<File | Blob | { data: string; contentType: string }>;  // Files to attach (uploaded to media store)
}
```

## Patterns & Examples

A Rool Space is a persistent, shared world model. Applications project different interaction patterns onto the same core primitives:

- **Objects** store durable state, with references to other objects via data fields
- **Channels** provide independent AI interaction contexts over shared objects
- **Events** describe what changed in real-time

Below are a few representative patterns.

### Chat With Generated Artifacts

- **Space**: documents, notes, images, tasks as objects
- **Channels**: each chat thread is a separate channel on the same space
- **UI**: renders interactions from `getInteractions()` as chat; derives artifact lists from object events

**Pattern**
- Interaction history syncs in real-time; UI renders entries as chat bubbles
- Artifacts are persistent objects shared across all channels
- Listen to `channelUpdated` event to update chat UI
- Selecting objects defines the AI working set via `objectIds`

### Multi-User World / Text Adventure

- **Space**: rooms, items, NPCs, players as objects
- **References**: navigation, containment, location via data fields
- **Channel**: player commands and narrative continuity

**Pattern**
- The space is the shared world state
- Objects can be created dynamically as the world expands
- AI generates descriptions and events using `{{placeholders}}`

### Collaborative Knowledge Graph

- **Space**: concepts, sources, hypotheses as objects
- **References**: semantic connections between objects via data fields
- **Channel**: exploratory analysis and questioning

**Pattern**
- Graph structure lives in object data fields containing other object IDs
- AI operates on selected subgraphs via `objectIds`
- Analysis results are stored; reasoning steps are transient

### Common Design Invariants

- Durable content lives in space objects
- References between objects are data fields whose values are object IDs
- Interaction history lives in channels (persistent, synced, truncated to 50 entries)
- UI state lives in the client, space metadata, or `_`-prefixed fields
- AI focus is controlled by object selection, not by replaying history

## License

MIT - see [LICENSE](../../LICENSE) for details.
