# Rool SDK

The TypeScript SDK for Rool, a persistent and collaborative environment for organizing objects.

The SDK manages authentication, real-time synchronization, and per-space file storage. Core primitives:

- **Spaces** — Containers for objects, schema, metadata, channels, and files
- **Channels** — Named contexts within a space. All object and AI operations go through a channel.
- **Conversations** — Independent interaction histories within a channel.
- **Objects** — Records addressed by a **location** path (`/space/<collection>/<basename>.json`). The body holds user-defined fields. References between objects are body fields whose values are location strings.
- **AI operations** — Create, update, or query objects using natural language and `{{placeholders}}`
- **File storage** — Every space has WebDAV file storage

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

// Create objects with AI-generated content using {{placeholders}}.
// First arg is the collection, second is the body.
const { object: sun } = await channel.createObject('body', {
  name: 'Sun',
  mass: '{{mass in solar masses}}',
  radius: '{{radius in km}}',
}, { basename: 'sun' });

const { object: earth } = await channel.createObject('body', {
  name: 'Earth',
  mass: '{{mass in Earth masses}}',
  radius: '{{radius in km}}',
  orbits: sun.location,  // Reference to the sun via its location
});

// Use the AI agent to work with your data
const { message, objects } = await channel.prompt(
  'Add the other planets in our solar system, each referencing the Sun'
);
console.log(message);  // AI explains what it did
console.log(`Modified ${objects.length} objects`);

// Read an object by location
const loadedEarth = await channel.getObject(earth.location);
console.log(loadedEarth?.body.name);

// Clean up
channel.close();
```

## Core Concepts

### Spaces and Channels

A **space** is a container that holds objects, schema, metadata, channels, and files. A **channel** is a named context within a space — it's the handle you use for all object and AI operations. Each channel contains one or more **conversations**, each with independent interaction history.

There are two main handles:
- **`RoolSpace`** — Live handle with SSE subscription for user management, link access, channel management, file storage, export, and channel lifecycle events. Extends `EventEmitter`.
- **`RoolChannel`** — Full real-time handle for objects, AI prompts, schema, and undo/redo.

```typescript
// Open a space — live handle with SSE subscription
const space = await client.openSpace('space-id');
await space.addUser(userId, 'editor');
await space.setLinkAccess('viewer');

// React to channel changes in real-time
space.on('channelCreated', (channel) => console.log('New channel:', channel.id));
space.on('channelUpdated', (channel) => console.log('Updated:', channel.id));
space.on('channelDeleted', (channelId) => console.log('Deleted:', channelId));

// Open a channel for object and AI operations
const channel = await space.openChannel('my-channel');
await channel.prompt('Create some planets');

// Open another channel on the same space
const channel2 = await space.openChannel('research');
await channel2.prompt('Analyze the data');  // Independent channel

// Clean up — stops subscription and closes all open channels
space.close();
```

The `channelId` is fixed when you open a channel and cannot be changed. To use a different channel, open a new one. Channels to the same space share the same objects and schema.

**Channel ID constraints:**
- 1–32 characters
- Only alphanumeric characters, hyphens (`-`), and underscores (`_`)

### Conversations

A **conversation** is a named interaction history within a channel. By default, all operations use the `'default'` conversation — most apps never need to think about conversations at all.

For apps that need multiple independent interaction threads (e.g., a chat sidebar with multiple threads), use `channel.conversation()` to get a handle scoped to a specific conversation:

```typescript
// Default conversation — most apps use this
const space = await client.openSpace('space-id');
const channel = await space.openChannel('main');
await channel.prompt('Hello');  // Uses 'default' conversation

// Conversation handle — for multi-thread UIs
const thread = channel.conversation('thread-42');
await thread.prompt('Hello');  // Uses 'thread-42' conversation
thread.getInteractions();      // Interactions for thread-42 only
```

Each conversation has its own interaction history and optional system instruction. Conversations are auto-created on first interaction — no explicit create step needed. The 200-interaction cap applies per conversation. All conversations share one SSE connection per channel.

```typescript
// System instructions are per-conversation
const thread = channel.conversation('research');
await thread.setSystemInstruction('Respond in haiku');

// List all conversations in this channel
const conversations = channel.getConversations();

// Delete a conversation (cannot delete 'default')
await channel.deleteConversation('old-thread');

// Rename a conversation
await thread.rename('Research Thread');
```

### Branching Conversations

The conversation history is a **tree**, not a flat list. Each interaction has a `parentId` pointing to the interaction it continues from. When you call `prompt()`, the SDK automatically continues from the current active leaf. To branch (edit/reroll), pass a different `parentInteractionId`:

```typescript
const thread = channel.conversation('chat');

// Normal conversation — each prompt auto-continues from the last
await thread.prompt('My favorite color is blue. Say OK.');
await thread.prompt('What is my favorite color?');  // Sees "blue"

// Branch: go back to the first message and say something different
const firstLeaf = thread.activeLeafId;  // ID of the "blue" interaction
const tree = thread.getTree();
const firstInteractionId = tree[firstLeaf!].parentId!;  // The root

await thread.prompt('My favorite color is red. Say OK.', {
  parentInteractionId: firstInteractionId,  // Sibling of "blue"
});
await thread.prompt('What is my favorite color?');  // Sees "red", not "blue"

// Switch back to the blue branch
thread.setActiveLeaf(firstLeaf!);
thread.getInteractions();  // Returns the blue branch (root → leaf)
```

**Key concepts:**
- `getInteractions()` returns the active branch as a flat `Interaction[]` (root → leaf)
- `getTree()` returns the full `Record<string, Interaction>` for branch navigation UI
- `activeLeafId` is the tip of the branch the user is currently viewing
- `setActiveLeaf(id)` switches branches (emits `conversationUpdated` so reactive UIs refresh)
- `prompt()` with no `parentInteractionId` auto-continues from `activeLeafId`
- `prompt()` with `parentInteractionId: null` starts a new root-level branch

### Objects, Locations, and References

Every object lives at a **location** — a path of the form `/space/<collection>/<basename>.json`. The collection is the parent directory, the basename is the filename without `.json`, and together they fully identify the object.

```typescript
{
  location: '/space/article/welcome.json',
  collection: 'article',
  basename: 'welcome',
  body: { title: 'Hello World', status: 'draft' },
}
```

The **body** holds the user-defined data.

**References** between objects are body fields whose values are location strings:

```typescript
// A planet references a star
{
  location: '/space/body/earth.json',
  collection: 'body',
  basename: 'earth',
  body: { name: 'Earth', orbits: '/space/body/sun.json' },
}

// An array of references
{
  location: '/space/team/alpha.json',
  collection: 'team',
  basename: 'alpha',
  body: {
    name: 'Alpha',
    members: [
      '/space/user/alice.json',
      '/space/user/bob.json',
      '/space/user/carol.json',
    ],
  },
}
```

References are just data — no special API is needed to create or remove them. Set a field to a location string to create a reference; clear it to remove it.

#### Location helpers

```typescript
import { loc, parseLocation, normalizeLocation, generateBasename } from '@rool-dev/sdk';

loc('article', 'welcome');                  // '/space/article/welcome.json'
parseLocation('/space/article/welcome.json'); // { collection: 'article', basename: 'welcome' }

// normalizeLocation accepts canonical or short form and returns canonical
normalizeLocation('article/welcome');         // '/space/article/welcome.json'
normalizeLocation('/space/article/welcome.json'); // unchanged

// 6-char random basename — same generator the SDK uses by default
generateBasename();                           // e.g., 'X7kQ9p'
```

SDK methods that accept a location (`getObject`, `updateObject`, `deleteObjects`, `moveObject`, etc.) accept either form and normalize internally. SDK return values always use the canonical full form.

#### Machine resource links

```typescript
import { resolveMachineResource } from '@rool-dev/sdk';

const objectResource = resolveMachineResource('/space/article/welcome.json');
// { kind: 'object', path: '/space/article/welcome.json' }

const fileResource = resolveMachineResource('/rool-drive/docs/readme.md');
// { kind: 'file', path: '/rool-drive/docs/readme.md' }
```

`rool-machine:` is the canonical URI scheme for user-visible resources from the Rool machine filesystem. `resolveMachineResource()` accepts either canonical `rool-machine:/...` URIs or bare machine paths such as `/rool-drive/...`, and returns the resource kind plus machine path. Fetch file resources through `space.fetchMachineResource(resource)`.

### AI Placeholder Pattern

Use `{{description}}` in body field values to have AI generate content:

```typescript
// Create with AI-generated content
await channel.createObject('article', {
  headline: '{{catchy headline about coffee}}',
  body: '{{informative paragraph}}',
});

// Update existing content with AI
await channel.updateObject('/space/article/welcome.json', {
  prompt: 'Make the body shorter and more casual'
});

// Add new AI-generated field to existing object
await channel.updateObject('/space/article/welcome.json', {
  data: { summary: '{{one-sentence summary}}' }
});
```

When resolving placeholders, the agent has access to the full body and the surrounding space context (except for `_`-prefixed fields). Placeholders are instructions, not templates, and do not need to repeat information already present in other fields.

Placeholders are resolved by the AI during the mutation and replaced with concrete values. The `{{...}}` syntax is never stored — it only guides the agent while creating or updating the object.

### Checkpoints & Undo/Redo

Undo/redo works on **checkpoints**, not individual operations. Call `checkpoint()` before making changes to create a restore point. Each checkpoint stores a snapshot of the entire space.

```typescript
// Create a checkpoint before user action
await channel.checkpoint('Delete object');
await channel.deleteObjects([location]);

// User can now undo back to the checkpoint
if (await channel.canUndo()) {
  await channel.undo(); // Restores the deleted object
}

// Redo reapplies the undone action
if (await channel.canRedo()) {
  await channel.redo(); // Deletes the object again
}
```

Checkpoints are **space-wide**: one shared stack across all channels and users. `undo()` restores the entire space — including any work others did since the checkpoint. Stacks are capped at 25 entries; identical-content checkpoints are deduped; a new checkpoint clears the redo stack.

### Hidden Fields

Body fields starting with `_` (e.g., `_ui`, `_cache`) are hidden from AI and ignored by the schema — you can add them to any object regardless of its collection definition. Otherwise they behave like normal fields: they sync in real-time, persist to the server, support undo/redo, and are visible to all users of the space. Use them for UI state, positions, or other data the AI shouldn't see or modify:

```typescript
await channel.createObject('article', {
  title: 'My Article',
  author: 'John Doe',
  _ui: { x: 100, y: 200, collapsed: false }
});
```

### Real-time Sync

Object and file reactivity is WebDAV-based. Listen for space-level file change notifications, then reconcile with `webdav.syncCollection()` using your sync token. This covers both object files under `/space` and user files under `/rool-drive`.

```typescript
let token: string | null = null;

async function syncFiles() {
  const result = await space.webdav.syncCollection('/', {
    token,
    level: 'infinite',
    props: ['displayname', 'getetag', 'getlastmodified', 'resourcetype'],
  });
  token = result.token;
  updateFileTree(result.responses);
}

space.on('filesChanged', syncFiles);
space.on('filesReset', () => { token = null; syncFiles(); });
await syncFiles();
```

### Locations & Basenames

By default, `createObject` mints a 6-character alphanumeric basename. Provide your own via `options.basename` for meaningful identifiers:

```typescript
await channel.createObject('article',
  { title: 'The Meaning of Life' },
  { basename: 'meaning-of-life' },
);
// → location: /space/article/meaning-of-life.json
```

**Why pin a basename?**
- **Fire-and-forget creation** — Know the location immediately without awaiting the response.
- **Meaningful identifiers** — Use domain-specific names like `welcome` or `2026-budget` for easier debugging and external references.

```typescript
// Fire-and-forget: create and reference without waiting
const basename = RoolClient.generateBasename();
const location = loc('note', basename);

channel.createObject('note', { text: '{{expand this idea}}' }, { basename });
channel.updateObject(parentLocation, {
  data: { notes: [...existingNotes, location] },
}); // Add reference immediately
```

**Basename constraints:**
- Must start with an alphanumeric character.
- Other characters may be alphanumeric, hyphens (`-`), or underscores (`_`).
- Must be unique within its collection (throws if the location already exists).

Use `moveObject` to rename an object or move it to a different collection — see [Moving and Renaming](#moving-and-renaming).

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
| `initialize(): Promise<boolean>` | **Call on app startup.** Processes auth callback from URL, sets up token refresh, returns auth state. Returns `false` if not authenticated. Throws if authenticated but account fetch fails (e.g. network error or invalid token). |
| `login(appName, params?): void` | Redirect to login page. The app name is displayed on the auth page ("Sign in to {appName}"). Optional `params` are added as query parameters to the auth URL. |
| `signup(appName, params?): void` | Redirect to signup page. The app name is displayed on the auth page ("Sign up for {appName}"). Optional `params` are added as query parameters to the auth URL. |
| `verify(token): Promise<boolean>` | Sign in using a verification token (from a `?verify=<token>` email link). Used by the official Rool app — most integrations won't need this. |
| `logout(): void` | Clear tokens and state |
| `isAuthenticated(): Promise<boolean>` | Check auth status (validates token) |
| `getAuthUser(): AuthUser` | Get auth identity from JWT (`{ email, name }`) |
| `setPassword(password): Promise<void>` | Set or change the current user's password. Requires an authenticated session. Password must be at least 8 characters and contain both letters and either digits or symbols. Throws with a human-readable message on validation or server failure. |

## AI Agent

The `prompt()` method is the primary way to invoke the AI agent. The agent has editor-level capabilities — it can create, modify, move, and delete objects — but cannot see or modify `_`-prefixed fields.

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
| `responseSchema` | Request structured JSON instead of text summary |
| `effort` | Effort level: `'QUICK'`, `'STANDARD'` (default), `'REASONING'`, or `'RESEARCH'` |
| `ephemeral` | If true, don't record in interaction history (useful for tab completion) |
| `readOnly` | If true, disable mutation tools (create, update, move, delete). Use for questions. |
| `parentInteractionId` | Parent interaction in the conversation tree. Omit to auto-continue from the active leaf. Pass `null` to start a new root-level branch. Pass a specific ID to branch from that point (edit/reroll). |
| `attachments` | Machine resources to focus the AI on, plus local files to upload (`File`, `Blob`, or `{ data, contentType, filename? }`). Pass object resources (`/space/...`) for object context and file resources (`/rool-drive/...`) for existing WebDAV files/folders. Local files are uploaded to authenticated space file storage first. The interaction stores canonical `rool-machine:/...` refs for UI rendering. The AI can interpret images (JPEG, PNG, GIF, WebP, SVG), PDFs, text-based files (plain text, Markdown, CSV, HTML, XML, JSON), and DOCX documents. Other file types are stored but the AI cannot natively consume their contents, only use shell tools on them. |
| `signal` | `AbortSignal` to stop the prompt mid-flight. When aborted, the agent loop halts and the streaming response closes. Note that any LLM turn already in flight on Vertex keeps generating server-side and is billed. |

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
const intro = resolveMachineResource('/space/article/intro.json');
const conclusion = resolveMachineResource('/space/article/conclusion.json');
if (!intro || !conclusion) throw new Error('invalid resource');
const result = await channel.prompt(
  "Summarize these articles",
  { attachments: [intro, conclusion] }
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

// Attach existing WebDAV files/folders or local uploads
const report = resolveMachineResource('/rool-drive/docs/report.pdf');
if (!report) throw new Error('invalid resource');
const file = fileInput.files[0]; // from <input type="file">
await channel.prompt(
  "Compare this report with the uploaded photo",
  { attachments: [report, file] }
);

// Cancel a long-running prompt
const ac = new AbortController();
cancelButton.onclick = () => ac.abort();
await channel.prompt("Do a deep analysis...", {
  effort: 'RESEARCH',
  signal: ac.signal,
});
```

### Structured Responses

Use `responseSchema` to get structured JSON instead of a text message:

```typescript
const resources = [
  '/space/item/widget.json',
  '/space/item/gadget.json',
  '/space/item/gizmo.json',
].map((path) => {
  const resource = resolveMachineResource(path);
  if (!resource) throw new Error(`invalid resource: ${path}`);
  return resource;
});

const { message } = await channel.prompt("Categorize these items", {
  attachments: resources,
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
- **Attached resources** — Object resources passed via `attachments` are given primary focus; file resources are surfaced as `/rool-drive/...` paths

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
| `editor` | Can create, modify, move, and delete objects |
| `viewer` | Read-only access (can query with `prompt` and read objects/files) |

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
| `currentUser: CurrentUser \| null` | Cached user profile from `initialize()`. Use for sync access to user info (id, email, name, etc.). Returns `null` before `initialize()` is called. |
| `getCurrentUser(): Promise<CurrentUser>` | Fetch fresh user profile from server (id, email, name, photoUrl, slug, plan, creditsBalance, totalCreditsUsed, createdAt, lastActivity, processedAt, storage) |
| `updateCurrentUser(input): Promise<CurrentUser>` | Update the current user's profile (`name`, `slug`). Returns the updated user. Slug must be 3–32 chars, start with a letter, and contain only lowercase alphanumeric characters, hyphens, and underscores. |
| `deleteCurrentUser(): Promise<void>` | Mark the current user's account for deletion (10-minute grace period before irreversible). Logs out the client. |
| `searchUser(email): Promise<UserResult \| null>` | Find user by exact email address (no partial matching) |

### Real-time Collaboration

When multiple users have a space open, object and file changes are announced by `space.on('filesChanged')` and reconciled through WebDAV `syncCollection()`. Channel/conversation state still emits channel events; filesystem state does not use channel object events.

See [Real-time Sync](#real-time-sync) for a WebDAV sync-token example.

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
| `openSpace(spaceId): Promise<RoolSpace>` | Open a space with live SSE subscription. Caches and reuses open spaces. Call `space.openChannel(channelId)` to get a channel. |
| `createSpace(name): Promise<RoolSpace>` | Create a new space, returns live handle with SSE subscription |
| `duplicateSpace(sourceSpaceId, name): Promise<RoolSpace>` | Duplicate an existing space. Returns a handle to the new space. |
| `deleteSpace(id): Promise<void>` | Permanently delete a space (cannot be undone) |
| `importArchive(name, archive): Promise<RoolSpace>` | Import from a zip archive, creating a new space |

### Channel Management

Manage channels on the `RoolSpace` handle:

| Method | Description |
|--------|-------------|
| `space.channels: ChannelInfo[]` | Live channel list (auto-updates via SSE) |
| `space.getChannels(): ChannelInfo[]` | List channels (deprecated — use `space.channels` instead) |
| `space.renameChannel(channelId, name): Promise<void>` | Rename a channel |
| `space.deleteChannel(channelId): Promise<void>` | Delete a channel and its interaction history |
| `channel.rename(name): Promise<void>` | Rename the current open channel |

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

### Extensions

Manage and publish extensions.

There are two distinct domains: your **personal library** (extensions you've created or installed) and the **published extensions** (extensions discoverable by all users). Each has its own return type.

#### Your Library (`ExtensionInfo`)

Manage extensions you own. Each `ExtensionInfo` includes `published` (whether it's listed in the marketplace) and `marketplaceExtensionId` (non-null if you installed it from someone else's listing, null if you authored it).

| Method | Description |
|--------|-------------|
| `uploadExtension(extensionId, options): Promise<ExtensionInfo>` | Upload or update an extension (`options.bundle`: zip with `index.html` and `manifest.json`) |
| `listExtensions(): Promise<ExtensionInfo[]>` | List your extensions |
| `getExtensionInfo(extensionId): Promise<ExtensionInfo \| null>` | Get info for a specific extension |
| `deleteExtension(extensionId): Promise<void>` | Delete an extension permanently (removes files and DB row) |

#### Marketplace (`PublishedExtensionInfo`)

Discover and install extensions published by other users.

| Method | Description |
|--------|-------------|
| `findExtensions(options?): Promise<PublishedExtensionInfo[]>` | Search the marketplace. Options: `query` (semantic search string), `limit` (default 20, max 100). Omit `query` to browse all. |
| `publishToPublic(extensionId): Promise<void>` | Publish one of your extensions to the marketplace |
| `unpublishFromPublic(extensionId): Promise<void>` | Remove from the marketplace (keeps the extension in your library) |

### Utilities

| Method | Description |
|--------|-------------|
| `RoolClient.generateBasename(): string` | Generate a 6-char alphanumeric basename for new object identities. |
| `RoolClient.generateId(): string` | Same as `generateBasename()`; retained for callers minting non-object IDs (interactions, conversations, channels). |
| `destroy(): void` | Clean up resources |

### Client Events

```typescript
client.on('authStateChanged', (authenticated: boolean) => void)
client.on('spaceAdded', (space: RoolSpaceInfo) => void)      // Space created or access granted
client.on('spaceRemoved', (spaceId: string) => void)         // Space deleted or access revoked
client.on('spaceRenamed', (spaceId: string, newName: string) => void)
client.on('channelCreated', (spaceId: string, channel: ChannelInfo) => void)
client.on('channelUpdated', (spaceId: string, channel: ChannelInfo) => void)
client.on('channelDeleted', (spaceId: string, channelId: string) => void)
client.on('userStorageChanged', ({ key, value, source }: UserStorageChangedEvent) => void)
client.on('connectionStateChanged', (state: 'connected' | 'disconnected' | 'reconnecting') => void)
client.on('error', (error: Error, context?: string) => void)
```

Channel events on the client (`channelCreated`, `channelUpdated`, `channelDeleted`) are pass-throughs from space events for backwards compatibility. Prefer listening on the space handle directly for new code.

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

A space handle with a live SSE subscription. Extends `EventEmitter`. Manages user access, link sharing, channels, file storage, and export. The `channels` property auto-updates via SSE, and channel lifecycle events fire in real-time.

`openSpace()` caches and reuses open spaces — calling it twice with the same ID returns the same instance. Call `close()` when done to stop the subscription and close all open channels.

### Properties

| Property | Description |
|----------|-------------|
| `id: string` | Space ID |
| `name: string` | Space name |
| `role: RoolUserRole` | User's role |
| `linkAccess: LinkAccess` | URL sharing level |
| `memberCount: number` | Number of users with access to the space |
| `channels: ChannelInfo[]` | Live channel list (auto-updates via SSE) |
| `webdav: RoolWebDAV` | WebDAV client for this space's file storage |

### Methods

| Method | Description |
|--------|-------------|
| `openChannel(channelId): Promise<RoolChannel>` | Open a channel on this space |
| `close(): void` | Stop SSE subscription and close all open channels |
| `rename(newName): Promise<void>` | Rename this space |
| `delete(): Promise<void>` | Permanently delete this space |
| `listUsers(): Promise<SpaceMember[]>` | List users with access |
| `addUser(userId, role): Promise<void>` | Add user to space |
| `removeUser(userId): Promise<void>` | Remove user from space |
| `setLinkAccess(linkAccess): Promise<void>` | Set URL sharing level |
| `getChannels(): ChannelInfo[]` | List channels (deprecated — use `channels` property instead) |
| `renameChannel(channelId, name): Promise<void>` | Rename a channel |
| `deleteChannel(channelId): Promise<void>` | Delete a channel |
| `installExtension(extensionId, channelId): Promise<string>` | Install an extension into a channel of this space. If you own it, wires it directly. If it's a marketplace extension, copies and builds a new extension in your library. Returns the channel ID. |
| `exportArchive(): Promise<Blob>` | Export space as zip archive |
| `getStorageUsage(): Promise<SpaceFileStorageUsage>` | Get WebDAV quota usage for this space |
| `fetchMachineResource(resource): Promise<Response>` | Fetch a resolved file `MachineResource` through this space |
| `refresh(): Promise<void>` | Refresh space data from server |

### Space Events

```typescript
space.on('channelCreated', (channel: ChannelInfo) => void)   // New channel added
space.on('channelUpdated', (channel: ChannelInfo) => void)   // Channel metadata changed (name, extension, manifest)
space.on('channelDeleted', (channelId: string) => void)      // Channel removed
space.on('filesChanged', ({ source, timestamp }) => void)     // WebDAV file storage changed; call webdav.syncCollection()
space.on('connectionStateChanged', (state: 'connected' | 'disconnected' | 'reconnecting') => void)
```

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
| `extensionUrl: string \| null` | URL of the installed extension, or null if this is a plain channel |
| `extensionId: string \| null` | ID of the installed extension, or null if this is a plain channel |
| `manifest: ExtensionManifest \| null` | Extension manifest snapshot (name, icon, collections, etc.), or null |

### Lifecycle

| Method | Description |
|--------|-------------|
| `close(): void` | Clean up resources and stop receiving updates |
| `rename(name): Promise<void>` | Rename this channel |
| `conversation(conversationId): ConversationHandle` | Get a handle scoped to a specific conversation (see [Conversations](#conversations)) |

### Object Operations

Objects are records addressed by location (`/space/<collection>/<basename>.json`). Every object must belong to a collection — create the collection first (see [Collection Schema](#collection-schema)). The body holds the user-defined fields.

All methods that accept a location accept either the canonical form or the short form (`collection/basename`).

| Method | Description |
|--------|-------------|
| `getObject(location): Promise<RoolObject \| undefined>` | Get an object, or undefined if not found. |
| `stat(location): RoolObjectStat \| undefined` | Get audit info for an object: when it was last modified, by whom, and where (channel/conversation/interaction). Sync read from local cache. |
| `createObject(collection, body, options?): Promise<{ object, message }>` | Create a new object in `collection`. The SDK mints a random basename unless you pass `options.basename`. |
| `updateObject(location, options): Promise<{ object, message }>` | Update an existing object's body. |
| `moveObject(from, to, options?): Promise<{ object, message }>` | Rename or relocate an object. See [Moving and Renaming](#moving-and-renaming). |
| `deleteObjects(locations): Promise<void>` | Delete objects by location. Other objects' refs become stale. |

#### createObject

```typescript
// Auto-generated basename
const { object } = await channel.createObject('article', {
  title: 'Hello',
  body: 'World',
});
// → object.location: '/space/article/X7kQ9p.json'

// Pinned basename
await channel.createObject('article',
  { title: 'Welcome' },
  { basename: 'welcome' },
);
// → location: '/space/article/welcome.json'

// AI placeholders
await channel.createObject('article', {
  headline: '{{catchy headline}}',
  body: '{{long-form intro}}',
});
```

| Option | Description |
|--------|-------------|
| `basename` | Specific basename to use. If omitted, the SDK generates a random 6-char one. |
| `ephemeral` | If true, the operation won't be recorded in interaction history. |
| `parentInteractionId` | Conversation tree parent. Omit to auto-continue; pass `null` for a new root. |

#### updateObject

```typescript
// Add/update fields
await channel.updateObject('/space/article/welcome.json', {
  data: { status: 'published' },
});

// Delete a field (pass null)
await channel.updateObject('/space/article/welcome.json', {
  data: { draft: null },
});

// AI-driven rewrite
await channel.updateObject('/space/article/welcome.json', {
  prompt: 'Tighten the intro by 30%.',
});
```

| Option | Description |
|--------|-------------|
| `data` | Body fields to add, update, or delete. `null` removes the field. Use `{{placeholder}}` for AI-generated content. Fields prefixed with `_` are hidden from AI. |
| `prompt` | Natural language instruction for AI to modify content. |
| `ephemeral` | If true, the operation won't be recorded in interaction history. |
| `parentInteractionId` | Conversation tree parent. Omit to auto-continue; pass `null` for a new root. |

Use `moveObject` to change an object's location (collection or basename).

#### Moving and Renaming

`moveObject` is how you rename an object (new basename in the same collection) or move it across collections. Pass `options.body` to atomically rewrite the body as part of the move.

```typescript
// Rename within the same collection
await channel.moveObject(
  '/space/article/welcome.json',
  '/space/article/hello-world.json',
);

// Move into a different collection
await channel.moveObject(
  '/space/draft/post-42.json',
  '/space/article/post-42.json',
);

// Move and replace body in one go
await channel.moveObject(from, to, {
  body: { title: 'Hello, world', status: 'published' },
});
```

| Option | Description |
|--------|-------------|
| `body` | Replace the body atomically as part of the move. If omitted, the body is preserved. |
| `ephemeral` | If true, the operation won't be recorded in interaction history. |
| `parentInteractionId` | Conversation tree parent. Omit to auto-continue; pass `null` for a new root. |

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

Store arbitrary data alongside the space without it being part of an object's body (e.g., viewport state, user preferences).

| Method | Description |
|--------|-------------|
| `setMetadata(key, value): void` | Set space-level metadata |
| `getMetadata(key): unknown` | Get metadata value, or undefined if key not set |
| `getAllMetadata(): Record<string, unknown>` | Get all metadata |

### Space File Storage

Every space has authenticated file storage. WebDAV is the SDK surface for that storage: paths are relative to the space root and collection operations use WebDAV collection semantics. Human/AI file links use `rool-machine:/rool-drive/...`; resolve those links with `resolveMachineResource()` and fetch file resources with `space.fetchMachineResource(resource)`.

Open a space, then use `space.webdav`.

```typescript
import { resolveMachineResource } from '@rool-dev/sdk';

const space = await client.openSpace('space-id');
const webdav = space.webdav;

await webdav.mkcol('docs');
await webdav.put('docs/readme.md', '# Hello', {
  contentType: 'text/markdown',
  ifNoneMatch: '*',
});

const listing = await webdav.propfind('docs/', {
  depth: '1',
  props: ['displayname', 'getcontentlength', 'getcontenttype', 'getetag'],
});

const file = await webdav.get('docs/readme.md');
console.log(await file.text());

const resource = resolveMachineResource('/rool-drive/docs/read me.md');
if (!resource || resource.kind !== 'file') throw new Error('not a file');
const sameFile = await space.fetchMachineResource(resource);

const usage = await space.getStorageUsage();
console.log(usage.usedBytes);
console.log(usage.availableBytes); // null means unlimited
console.log(usage.limitBytes);     // null means unlimited

const rootProps = await webdav.propfind('', {
  depth: '0',
  props: ['sync-token', 'supported-report-set'],
});
let syncToken = rootProps.responses[0]?.props.syncToken ?? null;

space.on('filesChanged', async () => {
  const delta = await space.webdav.syncCollection('', {
    token: syncToken,
    level: 'infinite',
  });
  syncToken = delta.token;
  console.log('Changed file responses:', delta.responses);
});
```

Paths are space-relative (`docs/readme.md`, not `/docs/readme.md`). WebDAV methods accept WebDAV paths only. User-facing file links should use `rool-machine:/rool-drive/...`; resolve either that URI or a bare `/rool-drive/...` machine path with `resolveMachineResource()` and fetch the resulting file resource with `space.fetchMachineResource(resource)`. `PUT` writes an exact path and does not create parent collections; create parents with `mkcol()` first. Helpers preserve WebDAV status semantics: non-success responses throw `WebDAVError` with `status`, `statusText`, and `body`.

| Method | Description |
|--------|-------------|
| `space.webdav` | WebDAV client for an open space |
| `space.getStorageUsage()` | Get WebDAV quota usage for an open space |
| `webdav.getStorageUsage()` | Get WebDAV quota usage through the WebDAV client |
| `webdav.path(path)` | Normalize a WebDAV path |
| `webdav.propfind(path, options)` | Read properties/list collections; explicit `depth` required. Supports `sync-token` and `supported-report-set` props. |
| `webdav.syncCollection(path, options)` | Reconcile WebDAV changes with `REPORT sync-collection`. Pass the previous `token` (or `null`), `level: '1' \| 'infinite'`, optional `props`/`limit`; returns changed responses plus the next `token`. |
| `webdav.get(path, options?)` / `webdav.head(path)` | Read a file, including optional byte ranges for `get` |
| `webdav.put(path, body, options?)` | Write an exact file path; parents must already exist |
| `webdav.mkcol(path)` | Create one collection |
| `webdav.copy(source, destination, options?)` | Copy a file or collection within the same space |
| `webdav.move(source, destination, options?)` | Move a file or collection within the same space |
| `webdav.delete(path, options?)` | Delete a file or collection |
| `webdav.lock(path, options)` / `webdav.refreshLock(path, token)` / `webdav.unlock(token)` | WebDAV Class 2 write locks |
| `webdav.request(method, path, init?)` | Raw authenticated WebDAV request escape hatch |

> **Note**: `resolveMachineResource()` returns either a file resource or an object resource. File resources point at user-visible files in the space's WebDAV storage and can be fetched with `space.fetchMachineResource(resource)`. Object resources identify records inside the space. They're not interchangeable.

#### File references from AI responses

When an agent refers to a user-visible file, the SDK contract is `rool-machine:/rool-drive/path/to/file.ext`. That prefix makes a file reference unambiguous without exposing the authenticated WebDAV URL. In free text, ambiguous characters such as spaces are percent-encoded (`rool-machine:/rool-drive/docs/read%20me.md`).

```typescript
const resource = resolveMachineResource('rool-machine:/rool-drive/docs/readme.md');
if (!resource || resource.kind !== 'file') throw new Error('not a file');
const response = await space.fetchMachineResource(resource);
const blob = await response.blob();
img.src = URL.createObjectURL(blob);
```

Plain relative strings like `docs/readme.md` are valid WebDAV paths when you already know you are working with file storage. In user text or agent output, use `rool-machine:/rool-drive/docs/readme.md` so clients do not have to guess whether a string is a file.

### Proxied Fetch

Fetch external URLs via the server, bypassing CORS restrictions. Requires editor role or above. Private/internal IP ranges are blocked (SSRF protection).

| Method | Description |
|--------|-------------|
| `fetch(url, init?): Promise<Response>` | Fetch a URL via the server proxy. `init` accepts `method`, `headers`, and `body`. |

```typescript
// GET request
const response = await channel.fetch('https://api.example.com/data');
const data = await response.json();

// POST with headers and body
const response = await channel.fetch('https://api.example.com/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: { key: 'value' },
});
```

### Collection Schema

Collections are the types you use to group objects in a space. Every object belongs to exactly one collection: the collection is the parent directory of its location, and the server validates the object's body against that collection's definition. Renaming a collection changes the location of every object bound to it; dropping a collection is blocked while any object still lives there.

Collections make up the schema and are stored in the space data, syncing in real time. The schema is visible to the AI agent so it knows which collections exist and what fields they contain, producing more consistent objects.


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
| `ref` | Reference to another object (location string) | `{ kind: 'ref' }` |
| `enum` | One of a set of values | `{ kind: 'enum', values: ['a', 'b'] }` |
| `literal` | Exact value | `{ kind: 'literal', value: 'fixed' }` |
| `array` | List of values | `{ kind: 'array', inner: { kind: 'string' } }` |
| `maybe` | Optional (nullable) | `{ kind: 'maybe', inner: { kind: 'number' } }` |

### Import/Export

Export and import space data as zip archives for backup, portability, or migration:

| Method | Description |
|--------|-------------|
| `space.exportArchive(): Promise<Blob>` | Export objects, metadata, channels, and files as a zip archive |
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

The archive bundles `data.json` (objects, metadata, and channels) together with the space file storage. File references are rewritten to relative paths within the archive and restored on import.

### Channel Events

Channel events are for channel/conversation state. Object and file reactivity goes through `space.on('filesChanged' | 'filesReset')` plus WebDAV `syncCollection()`.

```typescript
// Channel metadata updated (name, extensionUrl)
channel.on('channelUpdated', ({ channelId, source }) => void)

// Conversation interaction history updated
channel.on('conversationUpdated', ({ conversationId, channelId, source }) => void)

// Space metadata / schema compatibility events
channel.on('metadataUpdated', ({ metadata, source }) => void)
channel.on('schemaUpdated', ({ schema, source }) => void)

// Full state replacement (undo/redo, resync after error)
channel.on('reset', ({ source }) => void)

// Sync error occurred
channel.on('syncError', (error: Error) => void)
```

### Error Handling

AI operations may fail due to rate limiting or other transient errors. Check `error.message` for user-friendly error text:

```typescript
try {
  await channel.updateObject(location, { prompt: 'expand this' });
} catch (error) {
  if (error.message.includes('temporarily unavailable')) {
    showToast('Service busy, please try again in a moment');
  } else {
    showToast(error.message);
  }
}
```

## Interaction History

Each channel contains one or more conversations, each with its own interaction history. History is stored as a tree (interactions linked by `parentId`) in the space data and syncs in real-time. Capped at 200 interactions per conversation.

### Conversation History Methods

| Method | Description |
|--------|-------------|
| `getInteractions(): Interaction[]` | Get the active branch as a flat array (root → leaf) |
| `getTree(): Record<string, Interaction>` | Get the full interaction tree for branch navigation |
| `activeLeafId: string \| undefined` | The tip of the currently active branch |
| `setActiveLeaf(id: string): void` | Switch to a different branch (emits `conversationUpdated`) |
| `getSystemInstruction(): string \| undefined` | Get system instruction for the default conversation |
| `setSystemInstruction(instruction): Promise<void>` | Set system instruction for the default conversation. Pass `null` to clear. |
| `getConversations(): ConversationInfo[]` | List all conversations in this channel |
| `deleteConversation(conversationId): Promise<void>` | Delete a conversation (cannot delete `'default'`) |
| `renameConversation(name): Promise<void>` | Rename the default conversation |

Channel management (listing, renaming, deleting channels) is done via the client — see [Channel Management](#channel-management).

### The ai Field

The `ai` field in interactions distinguishes AI-generated responses from synthetic confirmations:
- `ai: true` — AI processed this operation (prompt, or createObject/updateObject with placeholders)
- `ai: false` — System confirmation only (e.g., "Created object /space/note/welcome.json")

### Tool Calls

The `toolCalls` array captures what the AI agent did during execution. The `conversationUpdated` event fires when each tool starts and completes. A tool call with `status: 'running'` has no result; once `status: 'done'`, `result` contains the truncated result string.

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
// An object addressed by location. References between objects are body
// fields whose values are location strings.
interface RoolObject {
  location: string;        // "/space/<collection>/<basename>.json"
  collection: string;
  basename: string;
  body: Record<string, unknown>;
}

// Object stat — audit information returned by channel.stat()
interface RoolObjectStat {
  location: string;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInChannel: string;                    // Channel ID where the last modification happened
  modifiedInConversation: string | null;        // Conversation ID, or null if not conversation-scoped
  modifiedInInteraction: string | null;         // Interaction ID, or null for ephemeral or non-AI writes
}
```

### Channels and Conversations

```typescript
// Conversation — holds interaction tree and optional system instruction
interface Conversation {
  name?: string;                  // Conversation name (optional)
  systemInstruction?: string;     // Custom system instruction for AI
  createdAt: number;              // Timestamp when conversation was created
  createdBy: string;              // User ID who created the conversation
  interactions: Record<string, Interaction>;  // Interaction tree (keyed by ID, linked by parentId)
}

// Conversation summary info (returned by channel.getConversations())
interface ConversationInfo {
  id: string;
  name: string | null;
  systemInstruction: string | null;
  createdAt: number;
  createdBy: string;
  interactionCount: number;
}

// Channel container with metadata and conversations
interface Channel {
  name?: string;                // Channel name (optional)
  createdAt: number;            // Timestamp when channel was created
  createdBy: string;            // User ID who created the channel
  createdByName?: string;       // Display name at time of creation
  extensionUrl?: string;        // URL of installed extension (set by installExtension)
  extensionId?: string;         // ID of installed extension (user_extensions.extension_id)
  manifest?: ExtensionManifest; // Extension manifest snapshot (set when extension is wired)
  conversations: Record<string, Conversation>;  // Keyed by conversation ID
}

// Channel summary info (returned by client.getChannels)
interface ChannelInfo {
  id: string;
  name: string | null;
  createdAt: number;
  createdBy: string;
  createdByName: string | null;
  interactionCount: number;
  extensionUrl: string | null;  // URL of installed extension, or null
  extensionId: string | null;   // ID of installed extension, or null
  manifest: ExtensionManifest | null;  // Extension manifest snapshot, or null
}
```

Note: `Channel` and `ChannelInfo` are data types describing the stored channel metadata. The `Channel` interface is the wire format; `RoolChannel` is the live SDK class you interact with.

### Interaction Types

```typescript
type ToolCall =
  | {
      id: string;
      name: string;      // Tool name (e.g., "create_object", "update_object", "search_web")
      input: unknown;    // Arguments passed to the tool
      status: 'running';
    }
  | {
      id: string;
      name: string;
      input: unknown;
      status: 'done';
      result: string;    // Truncated result
    };

type InteractionStatus = 'pending' | 'streaming' | 'done' | 'error';

interface Interaction {
  id: string;                              // Unique ID for this interaction
  parentId: string | null;                 // Parent in conversation tree (null = root)
  timestamp: number;
  userId: string;                          // Who performed this interaction
  userName?: string | null;                // Display name at time of interaction
  operation: 'prompt' | 'createObject' | 'updateObject' | 'moveObject' | 'deleteObjects';
  input: string;                           // What the user did: prompt text or action description
  output: string | null;                   // AI response or confirmation message (may be partial when streaming)
  status: InteractionStatus;               // Lifecycle status (pending → streaming → done/error)
  ai: boolean;                             // Whether AI was invoked (vs synthetic confirmation)
  modifiedObjectLocations: string[];       // Locations of objects affected by this interaction
  toolCalls: ToolCall[];                   // Tools called during this interaction (for AI prompts)
  attachments?: string[];                  // canonical rool-machine:/... resource refs attached by the user
}
```

### Info Types

```typescript
type RoolUserRole = 'owner' | 'admin' | 'editor' | 'viewer';
type LinkAccess = 'none' | 'viewer' | 'editor';

interface RoolSpaceInfo { id: string; name: string; inboundEmailAddress: string; role: RoolUserRole; ownerId: string; size: number; createdAt: string; updatedAt: string; linkAccess: LinkAccess; memberCount: number; }
interface SpaceMember { id: string; email: string; role: RoolUserRole; photoUrl: string | null; }
interface UserResult { id: string; email: string; name: string | null; photoUrl: string | null; }
interface CurrentUser { id: string; email: string; name: string | null; photoUrl: string | null; slug: string; plan: string; creditsBalance: number; totalCreditsUsed: number; createdAt: string; lastActivity: string; processedAt: string; storage: Record<string, unknown>; }
type ChangeSource = 'local_user' | 'remote_user' | 'remote_agent' | 'system';
```

### Prompt Options

```typescript
type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';
type PromptAttachment = File | Blob | { data: string; contentType: string; filename?: string } | MachineResource;

interface PromptOptions {
  responseSchema?: Record<string, unknown>;
  effort?: PromptEffort;                                                 // Effort level (default: 'STANDARD')
  ephemeral?: boolean;                                                   // Don't record in interaction history
  readOnly?: boolean;                                                    // Disable mutation tools (default: false)
  parentInteractionId?: string | null;                                   // Branch from a specific interaction (omit to auto-continue)
  attachments?: PromptAttachment[];                                      // Machine resources or local files to upload
  signal?: AbortSignal;                                                  // Cancel an in-flight prompt
}
```

## License

MIT - see [LICENSE](../../LICENSE) for details.
