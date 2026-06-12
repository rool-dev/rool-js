# Rool SDK

TypeScript SDK for Rool, a persistent collaborative workspace for objects, AI-assisted editing, and per-space files.

Core primitives:

- **Spaces** — containers for objects, schema, metadata, channels, collaborators, and files.
- **Channels** — named contexts within a space for object operations and AI conversations.
- **Conversations** — independent interaction histories within a channel.
- **Objects** — JSON records addressed by object paths such as `/space/article/welcome.json`.
- **Files** — user-visible files stored under `/rool-drive/...` through WebDAV.

## Installation

```bash
npm install @rool-dev/sdk
```

## Quick Start

```typescript
import { RoolClient } from '@rool-dev/sdk';

async function main() {
  const client = new RoolClient();

  if (!(await client.initialize())) {
    await client.login('My App');
    // Browser auth redirects away. Run startup again after the auth callback.
    return;
  }

  const space = await client.createSpace('Solar System');
  const channel = await space.openChannel('main');

  await channel.createCollection('body', [
    { name: 'name', type: { kind: 'string' } },
    { name: 'mass', type: { kind: 'string' } },
    { name: 'radius', type: { kind: 'string' } },
    { name: 'orbits', type: { kind: 'maybe', inner: { kind: 'ref' } } },
  ]);

  const { object: sun } = await channel.putObject('/space/body/sun.json', {
    name: 'Sun',
    mass: '1 solar mass',
    radius: '696,340 km',
  });

  const { object: earth } = await channel.putObject('/space/body/earth.json', {
    name: 'Earth',
    mass: '1 Earth mass',
    radius: '6,371 km',
    orbits: sun.path,
  });

  const { message, objects } = await channel.prompt(
    'Add the other planets in our solar system, each referencing the Sun.'
  );

  console.log(message);
  console.log(`Modified ${objects.length} objects`);

  const loadedEarth = await channel.getObject(earth.path);
  console.log(loadedEarth?.body.name);

  space.close();
}

void main();
```

## Paths and Resource URIs

Most SDK methods take plain path strings:

- Object paths: `/space/<collection>/<name>.json` (exactly three segments; no dotfile collection or object names)
- File paths: `/rool-drive/<path/to/file>`

`rool-machine:/...` URIs are the user-facing/canonical form for resource references in prompt attachments and interaction history. The exported helpers normalize between these forms when you need them.

```typescript
import { machinePath, machineUri, isObjectPath } from '@rool-dev/sdk';

machinePath('rool-machine:/rool-drive/docs/read%20me.md');
// '/rool-drive/docs/read me.md'

machineUri('/space/article/welcome.json');
// 'rool-machine:/space/article/welcome.json'

isObjectPath('/space/article/welcome.json'); // true
```

Object APIs require full object paths. References between objects are ordinary body fields containing object paths:

```typescript
{
  path: '/space/body/earth.json',
  body: { name: 'Earth', orbits: '/space/body/sun.json' },
}
```

## Authentication

### Browser

The default auth provider stores tokens in browser storage and redirects to the Rool auth page.

```typescript
async function start() {
  const client = new RoolClient();

  if (!(await client.initialize())) {
    await client.login('My App');
    // Browser auth redirects; stop startup until the callback reloads the app.
    return;
  }

  // Use the authenticated client here.
}

void start();
```

### Node.js

Use the Node auth provider for CLIs and scripts. It stores endpoint-scoped credentials under `~/.config/rool/` by default (for example, `credentials-<hash>.json`) and opens a browser for login.

```typescript
import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';

const client = new RoolClient({ authProvider: new NodeAuthProvider() });
let authenticated = await client.initialize();

if (!authenticated) {
  await client.login('My CLI Tool');
  // Re-run initialize after the non-redirect login to hydrate currentUser,
  // user storage, and client-level event subscriptions.
  authenticated = await client.initialize();
}

if (!authenticated) throw new Error('Login required');
```

### Auth API

| Method | Description |
| --- | --- |
| `initialize(): Promise<boolean>` | Call on startup. Initializes auth, refreshes user/storage state, and starts client events when authenticated. |
| `login(appName, params?): Promise<void>` | Start login flow. |
| `signup(appName, params?): Promise<void>` | Start signup flow. |
| `verify(token): Promise<boolean>` | Complete email verification token flow; returns `false` when the active auth provider does not implement verification. |
| `logout(): void` | Clear auth state and close open spaces. |
| `isAuthenticated(): Promise<boolean>` | Whether credentials are held locally. No network call — a server outage does not read as logged out. |
| `getAuthUser(): AuthUser` | Return auth identity decoded from the token. |
| `setPassword(password): Promise<void>` | Set/change password for the current user. |

### Offline behavior

A temporarily unreachable server never reads as "logged out". `initialize()` reports authentication from stored credentials, so on an offline start it can return `true` while `currentUser` is still `null` and user storage is empty — the SDK keeps reconnecting in the background and hydrates both automatically once the server is reachable, emitting `currentUserChanged`. Only an invalid or expired refresh token ends the session, via `authStateChanged(false)`.

## Spaces and Channels

Open a space to receive live events and manage collaborators, file storage, and channels. Open a channel to work with objects, schema, metadata, and AI.

```typescript
const space = await client.openSpace('space-id');

space.on('channelCreated', (channel) => console.log(channel.id));
space.on('filesChanged', () => console.log('files changed'));

const channel = await space.openChannel('main');
await channel.prompt('Summarize this space');
```

Channel IDs must be 1–32 characters and contain only letters, numbers, `_`, and `-`.

## Object Operations

Objects are JSON files under `/space`. Create the collection before writing objects in it.

```typescript
await channel.createCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'string' } },
]);

// Create or replace an exact object path
const { object } = await channel.putObject('/space/article/welcome.json', {
  title: 'Welcome',
  status: 'draft',
});

// Patch fields; null or undefined deletes a field
await channel.patchObject(object.path, {
  data: { status: 'published', obsoleteField: null },
});

// Read one or many objects
await channel.getObject('/space/article/welcome.json');
await channel.getObjects([
  '/space/article/welcome.json',
  '/space/article/intro.json',
]);

// Rename or move an object
await channel.moveObject(
  '/space/article/welcome.json',
  '/space/article/hello-world.json'
);

// Delete objects
await channel.deleteObjects(['/space/article/hello-world.json']);
```

| Method | Description |
| --- | --- |
| `getObject(path): Promise<RoolObject | undefined>` | Fetch one object by object path. |
| `getObjects(paths): Promise<GetObjectsResult>` | Fetch objects in bulk; returns `objects` and `missing`. |
| `stat(path): RoolObjectStat | undefined` | Cached audit info for an object. |
| `putObject(path, body): Promise<{ object, message }>` | Create or replace an object at an exact path. |
| `patchObject(path, { data }): Promise<{ object, message }>` | Patch an object's body; `null`/`undefined` deletes fields. |
| `moveObject(from, to, options?): Promise<{ object, message }>` | Rename or relocate an object; `options.body` can replace the body after moving. |
| `deleteObjects(paths): Promise<void>` | Delete object files. |

## AI Agent

`prompt()` invokes the AI agent. The agent can inspect space context and, unless `readOnly` or a read-only effort is used, create/modify/move/delete objects.

```typescript
const { message, objects } = await channel.prompt(
  'Create a topic node for the solar system, then child nodes for each planet.'
);

console.log(message);
console.log(objects.map((object) => object.path));
```

### Prompt Options

| Option | Description |
| --- | --- |
| `responseSchema` | Request structured JSON text matching a JSON-schema-like shape. |
| `effort` | `'QUICK'` (fast/read-only), `'STANDARD'` (default), `'REASONING'`, or `'RESEARCH'`. |
| `ephemeral` | Do not record the prompt in interaction history. |
| `readOnly` | Disable mutation tools. |
| `parentInteractionId` | Conversation-tree parent. Omit to continue from the active leaf; pass `null` for a new root branch. |
| `attachments` | Existing object/file paths or `rool-machine:/...` URIs, plus local files (`File`, `Blob`, or `{ data, contentType, filename? }`). |
| `signal` | AbortSignal used to request that the server stop an in-flight prompt. |
| `eventName` | Optional telemetry event name. Defaults to `'prompt_user'`. |

```typescript
// Read-only quick question
await channel.prompt('What topics are covered?', {
  effort: 'QUICK', // fast/read-only
});

// Focus on existing objects and files
await channel.prompt('Compare these resources', {
  attachments: [
    '/space/article/intro.json',
    'rool-machine:/rool-drive/docs/report.pdf',
  ],
});

// Upload a local file as an attachment
await channel.prompt('Describe this image', {
  attachments: [fileInput.files![0]],
});

// Structured response
const { message } = await channel.prompt('Categorize these items', {
  responseSchema: {
    type: 'object',
    properties: {
      categories: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  },
});
const result = JSON.parse(message);

// Stop a long prompt with a signal (when the caller holds the controller)
const ac = new AbortController();
const promptPromise = channel.prompt('Do a deep analysis', {
  effort: 'RESEARCH',
  signal: ac.signal,
});
ac.abort(); // asks the server to stop the in-flight interaction
await promptPromise;
```

### Stopping interactions

Use `signal` when the same call site cancels the prompt. When the Stop button
lives elsewhere — a different component, after a reload, or a prompt another
client started — stop by ID or stop the conversation's active interaction
instead. Both are best-effort: the server halts the agent loop and closes the
stream, but an LLM turn already in flight keeps generating server-side and is
billed.

```typescript
// Stop whatever is in flight on this channel's (default) conversation.
// No-op returning false when nothing is running.
await channel.stop();

// Stop a specific interaction by ID (e.g. from channel.activeLeafId or
// the interactions list). Returns whether the server stopped it.
await channel.stopInteraction(channel.activeLeafId!);

// Conversation handles stop their own in-flight interaction.
const thread = channel.conversation('thread-42');
await thread.stop();
```

| Method | Description |
| --- | --- |
| `stop(): Promise<boolean>` | Stop the in-flight interaction on the default conversation; `false` if none. |
| `stopInteraction(id): Promise<boolean>` | Ask the server to stop a specific interaction by ID. |
| `conversation.stop(): Promise<boolean>` | Stop a specific conversation's in-flight interaction. |

## Conversations

Every channel has a default conversation. Use `channel.conversation(id)` for independent histories (for example, multiple chat threads). Conversations are represented as trees: interactions point at a `parentId`, and the SDK tracks an active leaf for each conversation.

```typescript
await channel.prompt('Hello'); // default conversation

const thread = channel.conversation('thread-42');
await thread.prompt('Hello from another thread');
await thread.setSystemInstruction('Answer in haiku');

const branch = thread.getInteractions(); // active branch, root → leaf
const tree = thread.getTree();           // full interaction tree

if (thread.activeLeafId) {
  thread.setActiveLeaf(thread.activeLeafId);
}
```

| Method/property | Description |
| --- | --- |
| `channel.conversation(id): ConversationHandle` | Get a conversation-scoped handle. |
| `getInteractions(): Interaction[]` | Active branch as a flat list. |
| `getTree(): Record<string, Interaction>` | Full interaction tree. |
| `activeLeafId` | Current branch tip. |
| `setActiveLeaf(id): void` | Switch branches. |
| `getSystemInstruction()` / `setSystemInstruction(value)` | Manage conversation system instruction. Pass `null` to clear. |
| `getConversations(): ConversationInfo[]` | List channel conversations (on `RoolChannel`). |
| `deleteConversation(id): Promise<void>` | Delete a non-active conversation. |
| `renameConversation(name): Promise<void>` | Rename the current/default conversation (on `RoolChannel`). |
| `conversation.rename(name): Promise<void>` | Rename a specific conversation handle. |

`ConversationHandle` also supports conversation-scoped `putObject`, `patchObject`, `moveObject`, `deleteObjects`, `prompt`, `stop`, collection-schema methods, and `setMetadata`.

## Schema and Metadata

Collections define the schema visible to the AI agent. Hidden body fields whose names start with `_` are useful for app/UI state that should not be considered by AI.

```typescript
await channel.createCollection('article', {
  schemaOrgType: 'Article',
  fields: [
    { name: 'title', type: { kind: 'string' } },
    { name: 'status', type: { kind: 'enum', values: ['draft', 'published'] } },
    { name: 'tags', type: { kind: 'array', inner: { kind: 'string' } } },
    { name: 'author', type: { kind: 'ref' } },
  ],
});

const schema = channel.getSchema();

await channel.alterCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'string' } },
]);

channel.setMetadata('viewport', { x: 0, y: 0, zoom: 1 });
const viewport = channel.getMetadata('viewport');
```

| Method | Description |
| --- | --- |
| `getSchema(): SpaceSchema` | Get collection definitions. |
| `createCollection(name, fieldsOrDef, options?): Promise<CollectionDef>` | Create a collection. |
| `alterCollection(name, fieldsOrDef, options?): Promise<CollectionDef>` | Replace a collection definition. |
| `dropCollection(name): Promise<void>` | Remove a collection and its object directory. |
| `setMetadata(key, value): void` | Set space metadata (fire-and-forget sync). |
| `getMetadata(key): unknown` | Read metadata from local cache. |
| `getAllMetadata(): Record<string, unknown>` | Read all metadata from local cache. |

Field kinds: `string`, `number`, `boolean`, `ref`, `enum`, `literal`, `array`, and `maybe`.

## Undo/Redo

Undo/redo uses checkpoints for the current channel ID. A checkpoint captures space state; call `checkpoint()` before a user action you want to make undoable.

```typescript
await channel.checkpoint('Delete article');
await channel.deleteObjects(['/space/article/welcome.json']);

if (await channel.canUndo()) {
  await channel.undo();
}
```

| Method | Description |
| --- | --- |
| `checkpoint(label?): Promise<string>` | Save current space state. |
| `canUndo(): Promise<boolean>` | Check whether undo is available. |
| `canRedo(): Promise<boolean>` | Check whether redo is available. |
| `undo(): Promise<boolean>` | Restore the latest checkpoint. |
| `redo(): Promise<boolean>` | Reapply undone work. |
| `clearHistory(): Promise<void>` | Clear checkpoint history. |

Undo/redo availability and history are scoped to the channel handle (`channel.channelId`).

## File Storage and WebDAV

Every space has authenticated WebDAV storage. WebDAV methods take SDK machine paths such as `/space/...`, `/rool-drive/...`, or `/` for the root collection.

```typescript
const webdav = space.webdav;

await webdav.mkcol('/rool-drive/docs');
await webdav.put('/rool-drive/docs/readme.md', '# Hello', {
  contentType: 'text/markdown',
  ifNoneMatch: '*',
});

const listing = await webdav.propfind('/rool-drive/docs', {
  depth: '1',
  props: ['displayname', 'getcontentlength', 'getcontenttype', 'getetag'],
});

const response = await webdav.get('/rool-drive/docs/readme.md');
console.log(await response.text());

const file = await space.fetchPath('/rool-drive/docs/readme.md');
console.log(file.headers.get('Content-Type'));

const usage = await space.getStorageUsage();
console.log(usage.usedBytes, usage.availableBytes, usage.limitBytes);
```

### Real-time file sync

Object and file changes are announced at the space level. Use WebDAV `syncCollection()` to reconcile changes.

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
space.on('filesReset', () => {
  token = null;
  void syncFiles();
});

await syncFiles();
```

| Method | Description |
| --- | --- |
| `webdav.href(path)` / `webdav.url(path)` | Return WebDAV href/URL for an absolute SDK path. |
| `webdav.options(path)` | Send `OPTIONS`. |
| `webdav.propfind(path, options)` | Read properties/list collections. `depth` is required. |
| `webdav.syncCollection(path, options)` | WebDAV `REPORT sync-collection`; returns changed responses and next token. |
| `webdav.get(path, options?)` / `webdav.head(path)` | Read a file; `get` supports byte ranges. |
| `webdav.put(path, body, options?)` | Write a file/object at an exact path. Parent collection must exist. |
| `webdav.mkcol(path)` | Create one collection. |
| `webdav.copy(source, destination, options?)` | Copy a file or collection. |
| `webdav.move(source, destination, options?)` | Move a file or collection. |
| `webdav.delete(path, options?)` | Delete a file or collection. |
| `webdav.lock(path, options)` / `refreshLock(path, token)` / `unlock(token)` | WebDAV write locks. |
| `webdav.request(method, path, init?)` | Raw authenticated WebDAV request. |
| `space.fetchPath(path, options?)` | Fetch a `/rool-drive/...` file path or `rool-machine:` file URI. |
| `space.getStorageUsage()` / `webdav.getStorageUsage()` | Storage quota usage. |

High-level WebDAV methods that validate response status throw `WebDAVError` with `status`, `statusText`, and `body`; raw `request()` and `options()` return `Response`.

## Collaboration

New members join a space by redeeming an invite. Owners and admins mint invites; the returned `url` contains the secret token and is only available at mint time.

```typescript
// Shareable invite link
const invite = await space.createInvite('editor', { expiresInDays: 7 });
console.log(invite.url);

// Email-guarded invite: single-use, locked to that address, sent by mail
const emailed = await space.createInvite('viewer', { email: 'colleague@example.com' });
if (emailed.emailStatus !== 'sent') {
  // Mail did not go out (e.g. no mail provider configured) — share emailed.url yourself
}

// Manage outstanding invites
const invites = await space.listInvites();
await space.revokeInvite(invites[0].inviteId);

// Change an existing member's role, or remove them
await space.setUserRole(userId, 'admin');
await space.removeUser(userId);
```

On the join page, look up the invite before sign-in and redeem it once authenticated:

```typescript
const preview = await client.previewInvite(token); // no auth required
console.log(preview.spaceName, preview.role, preview.inviterName);

const result = await client.redeemInvite(token);
console.log(result.spaceId, result.status); // 'joined' | 'upgraded' | 'already_member'
```

Invalid, expired, revoked, exhausted, or email-mismatched invites throw `InviteError` with a `code` of `'INVITE_INVALID' | 'INVITE_EXPIRED' | 'INVITE_REVOKED' | 'INVITE_EXHAUSTED' | 'INVITE_EMAIL_MISMATCH'`.

```typescript
import { InviteError } from '@rool-dev/sdk';

try {
  await client.redeemInvite(token);
} catch (error) {
  if (error instanceof InviteError && error.code === 'INVITE_EXPIRED') {
    // Ask for a fresh invite
  }
}
```

Roles (invites grant `admin`, `editor`, or `viewer` — never `owner`):

| Role | Capabilities |
| --- | --- |
| `owner` | Full control. |
| `admin` | Editor capabilities plus user/link management. |
| `editor` | Create, modify, move, and delete objects/files. |
| `viewer` | Read-only access. |

## RoolClient API

### Constructor config

```typescript
const client = new RoolClient({
  apiUrl: 'https://api.rool.dev',
  authUrl: 'https://rool.dev/auth',
  graphqlUrl: 'https://api.rool.dev/graphql',
  logger: console,
});
```

`apiUrl` defaults to `https://api.rool.dev`; `authUrl` is derived by stripping the `api.` hostname prefix unless provided. `baseUrl` is still accepted as a deprecated alias for `apiUrl`. Pass `authProvider` for Node.js, Electron, or custom auth flows.

| Method/property | Description |
| --- | --- |
| `currentUser: CurrentUser | null` | Cached user profile from initialization/fetch. |
| `getCurrentUser(): Promise<CurrentUser>` | Fetch current user. |
| `updateCurrentUser(input): Promise<CurrentUser>` | Update `name`, `slug`, or `marketingOptIn`. |
| `deleteCurrentUser(): Promise<void>` | Mark account for deletion and log out. |
| `previewInvite(token): Promise<InvitePreview>` | Look up an invite link without redeeming it. No auth required. |
| `redeemInvite(token): Promise<InviteRedeemResult>` | Redeem an invite, joining (or upgrading in) its space. |
| `listSpaces(): Promise<RoolSpaceInfo[]>` | List accessible spaces. |
| `openSpace(id): Promise<RoolSpace>` | Open/cached live space handle. |
| `createSpace(name): Promise<RoolSpace>` | Create and open a space. |
| `duplicateSpace(sourceId, name): Promise<RoolSpace>` | Duplicate a space. |
| `deleteSpace(id): Promise<void>` | Permanently delete a space. |
| `importArchive(name, archive): Promise<RoolSpace>` | Import a zip archive as a new space. |
| `getUserStorage<T>(key): T | undefined` | Sync read from user-storage cache. |
| `setUserStorage(key, value): void` | Update user storage; `null`/`undefined` deletes. |
| `getAllUserStorage(): Record<string, unknown>` | Copy all cached user storage. |
| `reportEvent(event, url?): void` | Fire-and-forget telemetry event. |
| `destroy(): void` | Close subscriptions, spaces, auth resources, and listeners. |
| `generateId(): string` | Generate a 6-character alphanumeric ID. |

### Client events

```typescript
client.on('authStateChanged', (authenticated) => void 0);
client.on('currentUserChanged', (user) => void 0); // CurrentUser | null; null on sign-out
client.on('spaceAdded', (space) => void 0);
client.on('spaceRemoved', (spaceId) => void 0);
client.on('spaceRenamed', (spaceId, newName) => void 0);
client.on('channelCreated', (spaceId, channel) => void 0);
client.on('channelUpdated', (spaceId, channel) => void 0);
client.on('channelDeleted', (spaceId, channelId) => void 0);
client.on('userStorageChanged', ({ key, value, source }) => void 0);
client.on('connectionStateChanged', (state) => void 0);
client.on('error', (error, context) => void 0);
```

## RoolSpace API

Properties: `id`, `name`, `role`, `memberCount`, `channels`, `route`, `webdav`.

| Method | Description |
| --- | --- |
| `openChannel(channelId): Promise<RoolChannel>` | Open/create a channel. |
| `close(): void` | Stop subscription and close open channels. |
| `rename(newName): Promise<void>` | Rename the space. |
| `delete(): Promise<void>` | Permanently delete the space. |
| `listUsers(): Promise<SpaceMember[]>` | List collaborators. |
| `setUserRole(userId, role): Promise<void>` | Change an existing member's role. |
| `removeUser(userId): Promise<void>` | Remove collaborator. |
| `createInvite(role, options?): Promise<SpaceInviteCreated>` | Mint an invite link; `options` takes `email`, `expiresInDays`, `maxUses`. |
| `listInvites(): Promise<SpaceInvite[]>` | List currently redeemable invites. |
| `revokeInvite(inviteId): Promise<boolean>` | Revoke an invite so its link stops working. |
| `renameChannel(channelId, name): Promise<void>` | Rename a channel. |
| `deleteChannel(channelId): Promise<void>` | Delete a channel and history. |
| `exportArchive(): Promise<Blob>` | Export a space archive. |
| `refresh(): Promise<void>` | Refresh cached space data. |
| `fetchPath(path, options?): Promise<Response>` | Fetch a `/rool-drive/...` file. |
| `getStorageUsage(): Promise<SpaceFileStorageUsage>` | File-storage quota usage. |

Events:

```typescript
space.on('channelCreated', (channel) => void 0);
space.on('channelUpdated', (channel) => void 0);
space.on('channelDeleted', (channelId) => void 0);
space.on('filesChanged', ({ spaceId, source, timestamp }) => void 0);
space.on('filesReset', ({ spaceId, source, timestamp }) => void 0);
space.on('connectionStateChanged', (state) => void 0);
```

## RoolChannel API

Properties: `id` (space ID), `name` (space name), `role`, `userId`, `channelId`, `channelName`, `conversationId`, `isReadOnly`, `activeLeafId`.

| Area | Methods |
| --- | --- |
| Lifecycle | `close()`, `rename(name)`, `conversation(id)` |
| Objects | `getObject`, `getObjects`, `stat`, `putObject`, `patchObject`, `moveObject`, `deleteObjects` |
| Schema | `getSchema`, `createCollection`, `alterCollection`, `dropCollection` |
| Metadata | `setMetadata`, `getMetadata`, `getAllMetadata` |
| Conversations | `getInteractions`, `getTree`, `setActiveLeaf`, `getConversations`, `deleteConversation`, `getSystemInstruction`, `setSystemInstruction`, `renameConversation` |
| AI | `prompt`, `stop`, `stopInteraction` |
| Undo/redo | `checkpoint`, `canUndo`, `canRedo`, `undo`, `redo`, `clearHistory` |
| Utilities | `fetch(url, init?)` server-side proxied fetch |

Channel events:

```typescript
channel.on('metadataUpdated', ({ metadata, source }) => void 0);
channel.on('schemaUpdated', ({ schema, source }) => void 0);
channel.on('channelUpdated', ({ channelId, source }) => void 0);
channel.on('conversationUpdated', ({ conversationId, channelId, source }) => void 0);
channel.on('reset', ({ source }) => void 0);
channel.on('syncError', (error) => void 0);
```

`channel.fetch(url, init?)` proxies external HTTP requests through the server to bypass browser CORS.

## Import/Export

```typescript
const archive = await space.exportArchive();
const imported = await client.importArchive('Imported Data', archive);
```

Archives include objects, metadata, channels/conversations, and file storage.

## Data Types

```typescript
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
  schemaOrgType?: string;
}

type SpaceSchema = Record<string, CollectionDef>;

interface RoolObject {
  path: string;
  body: Record<string, unknown>;
}

interface GetObjectsResult {
  objects: RoolObject[];
  missing: string[];
}

type InviteRole = 'admin' | 'editor' | 'viewer';

interface SpaceInvite {
  inviteId: string;
  spaceId: string;
  role: InviteRole;
  email: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
}

// Outcome of the invite email send; null when no email was involved (open link).
// 'not_configured' means the server has no mail provider (local dev). Future
// codes may appear; treat unknown values as not sent.
type InviteEmailStatus = 'sent' | 'not_configured' | 'failed' | (string & {});

interface SpaceInviteCreated {
  inviteId: string;
  spaceId: string;
  role: InviteRole;
  email: string | null;
  expiresAt: string;
  maxUses: number | null;
  url: string; // contains the secret token; only available at mint time
  emailStatus: InviteEmailStatus | null;
}

interface InvitePreview {
  spaceId: string;
  spaceName: string;
  role: InviteRole;
  email: string | null;
  inviterName: string | null;
}

interface InviteRedeemResult {
  spaceId: string;
  role: RoolUserRole;
  status: 'joined' | 'upgraded' | 'already_member';
}

interface RoolObjectStat {
  path: string;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
  modifiedInChannel: string;
  modifiedInConversation: string | null;
  modifiedInInteraction: string | null;
}

type PromptAttachment =
  | File
  | Blob
  | { data: string; contentType: string; filename?: string }
  | string;

type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';

interface PromptOptions {
  responseSchema?: Record<string, unknown>;
  effort?: PromptEffort;
  parentInteractionId?: string | null;
  ephemeral?: boolean;
  readOnly?: boolean;
  attachments?: PromptAttachment[];
  signal?: AbortSignal;
  eventName?: string;
}

type InteractionStatus = 'pending' | 'streaming' | 'done' | 'error';

interface Interaction {
  id: string;
  parentId: string | null;
  timestamp: number;
  userId: string;
  userName?: string | null;
  operation: 'prompt' | 'putObject' | 'patchObject' | 'moveObject' | 'deleteObjects' | 'deletePaths' | string;
  input: string;
  output: string | null;
  status: InteractionStatus;
  ai: boolean;
  modifiedObjectPaths: string[];
  toolCalls: ToolCall[];
  attachments?: string[];
}
```

## License

MIT - see [LICENSE](../../LICENSE) for details.
