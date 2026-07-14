# Rool SDK

TypeScript SDK for Rool, a persistent collaborative workspace for objects, AI-assisted editing, and per-space files.

Core primitives:

- **Spaces** — containers for objects, schema, metadata, conversations, collaborators, and files.
- **Conversations** — independent interaction histories in a space.
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
  const conversation = space.conversation('main');

  await space.createCollection('body', [
    { name: 'name', type: { kind: 'string' } },
    { name: 'mass', type: { kind: 'string' } },
    { name: 'radius', type: { kind: 'string' } },
    { name: 'orbits', type: { kind: 'maybe', inner: { kind: 'ref' } } },
  ]);

  const { object: sun } = await space.putObject('/space/body/sun.json', {
    name: 'Sun',
    mass: '1 solar mass',
    radius: '696,340 km',
  });

  const { object: earth } = await space.putObject('/space/body/earth.json', {
    name: 'Earth',
    mass: '1 Earth mass',
    radius: '6,371 km',
    orbits: sun.path,
  });

  const { message, objects } = await conversation.prompt(
    'Add the other planets in our solar system, each referencing the Sun.'
  );

  console.log(message);
  console.log(`Modified ${objects.length} objects`);

  const loadedEarth = await space.getObject(earth.path);
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

### Native (Capacitor, Cordova, Tauri, ...)

Use the native PKCE provider for JS app shells that sign in through an external
system browser. `login()`/`signup()` open the auth server's `/authorize` page
via the `openExternal` callback you supply; when the deep link returns, feed it
to `client.handleAuthRedirect(url)` from your platform's deep-link handler. The
code is exchanged for a session at `/token` and tokens are stored like the
browser provider.

```typescript
import { RoolClient, NativePkceAuthProvider } from '@rool-dev/sdk';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

const client = new RoolClient({
  authProvider: new NativePkceAuthProvider({
    redirectUri: 'roolandroidauth://auth/callback', // must match the server allowlist
    defaultProvider: 'google',                       // 'google' | 'apple'
    openExternal: (url) => Browser.open({ url }),
  }),
});

// Complete sign-in when the OS hands the app its deep link.
App.addListener('appUrlOpen', async ({ url }) => {
  if (await client.handleAuthRedirect(url)) {
    await Browser.close();
    // Now authenticated — refresh your UI.
  }
});

if (!(await client.initialize())) {
  // Opens the system browser; completion arrives via the listener above.
  await client.login('My App'); // pass { provider: 'apple' } to override the default
}
```

#### Email + password and magic links (native)

The native provider also supports email/password sign-in and magic links —
no system browser, the server returns the token set as JSON directly.

```typescript
// Password sign-in
const result = await client.signInWithPassword(email, password);
if (result.status === 'signed_in') {
  // authenticated — refresh your UI
} else {
  // status === 'verify_required': the email isn't verified yet and the server
  // has emailed a magic link. Tell the user to check their inbox.
}

// Or request a magic link explicitly
await client.requestMagicLink(email);
```

The magic link carries a `?verify=<token>` param; complete sign-in by passing
that token to `client.verify(token)` once the link lands back in the app.

> **⚠️ Magic links open the website, not the app, until Universal Links / App
> Links are configured.** The emailed link is an `https://` URL for the Rool
> web app. On native, an `https` link only re-opens your app if you've set up
> [iOS Universal Links](https://developer.apple.com/ios/universal-links/) /
> [Android App Links](https://developer.android.com/training/app-links) for that
> domain (custom-scheme deep links don't apply to email links). **Without that
> setup the magic link completes sign-in in the browser/website, not in the
> native app** — so for now treat magic links on native as a website hand-off,
> and prefer password or social sign-in for an in-app experience.

### Auth API

| Method | Description |
| --- | --- |
| `initialize(): Promise<boolean>` | Call on startup. Initializes auth, refreshes user/storage state, and starts client events when authenticated. |
| `login(appName, params?): Promise<void>` | Start login flow. |
| `signup(appName, params?): Promise<void>` | Start signup flow. |
| `verify(token): Promise<boolean>` | Complete email verification token flow; returns `false` when the active auth provider does not implement verification. |
| `handleAuthRedirect(url): Promise<boolean>` | Complete a native PKCE sign-in from a deep-link callback URL. Returns `false` when the active auth provider does not implement it. |
| `signInWithPassword(email, password): Promise<PasswordSignInResult>` | Email + password sign-in (native provider). Resolves `{ status: 'signed_in' }`, or `{ status: 'verify_required' }` when the email is unverified (a magic link was emailed). Rejects on bad credentials. |
| `requestMagicLink(email): Promise<void>` | Email the user a magic sign-in link (native provider). See the caveat below — on native the link opens the **website**, not the app, until Universal Links / App Links are configured. |
| `logout(): void` | Clear auth state and close open spaces. |
| `isAuthenticated(): Promise<boolean>` | Whether credentials are held locally. No network call — a server outage does not read as logged out. |
| `getAuthUser(): AuthUser` | Return auth identity decoded from the token. |
| `setPassword(password): Promise<void>` | Set/change password for the current user. |

### Offline behavior

A temporarily unreachable server never reads as "logged out". `initialize()` reports authentication from stored credentials, so on an offline start it can return `true` while `currentUser` is still `null` and user storage is empty — the SDK keeps reconnecting in the background and hydrates both automatically once the server is reachable, emitting `currentUserChanged`. Only an invalid or expired refresh token ends the session, via `authStateChanged(false)`.

## Spaces and Conversations

Open a space to receive live events and manage collaborators, file storage, and conversations. Open a conversation to work with objects, schema, metadata, and AI.

```typescript
const space = await client.openSpace('space-id');

const conversation = space.conversation('main');
space.on('filesChanged', () => console.log('files changed'));

await conversation.prompt('Summarize this space');
```

Conversation IDs must be 1–32 characters and contain only letters, numbers, `_`, and `-`.

## Object Operations

Objects are JSON files under `/space`. Create the collection before writing objects in it.

```typescript
await space.createCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'string' } },
]);

// Create or replace an exact object path
const { object } = await space.putObject('/space/article/welcome.json', {
  title: 'Welcome',
  status: 'draft',
});

// Patch fields; null or undefined deletes a field
await space.patchObject(object.path, {
  data: { status: 'published', obsoleteField: null },
});

// Read one or many objects
await space.getObject('/space/article/welcome.json');
await space.getObjects([
  '/space/article/welcome.json',
  '/space/article/intro.json',
]);

// Rename or move an object
await space.moveObject(
  '/space/article/welcome.json',
  '/space/article/hello-world.json'
);

// Delete objects
await space.deleteObjects(['/space/article/hello-world.json']);
```

| Method | Description |
| --- | --- |
| `getObject(path): Promise<RoolObject | undefined>` | Fetch one object by object path. |
| `getObjects(paths): Promise<GetObjectsResult>` | Fetch objects in bulk; returns `objects` and `missing`. |
| `space.putObject(path, body): Promise<{ object, message }>` | Create or replace an object at an exact path. |
| `space.patchObject(path, { data }): Promise<{ object, message }>` | Patch an object's body; `null`/`undefined` deletes fields. |
| `space.moveObject(from, to, options?): Promise<{ object, message }>` | Rename or relocate an object; `options.body` can replace the body after moving. |
| `space.deleteObjects(paths): Promise<void>` | Delete object files. |

## AI Agent

`prompt()` invokes the AI agent. The agent can inspect space context and, unless `readOnly` or a read-only effort is used, create/modify/move/delete objects.

```typescript
const { message, objects } = await conversation.prompt(
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
await conversation.prompt('What topics are covered?', {
  effort: 'QUICK', // fast/read-only
});

// Focus on existing objects and files
await conversation.prompt('Compare these resources', {
  attachments: [
    '/space/article/intro.json',
    'rool-machine:/rool-drive/docs/report.pdf',
  ],
});

// Upload a local file as an attachment
await conversation.prompt('Describe this image', {
  attachments: [fileInput.files![0]],
});

// Structured response
const { message } = await conversation.prompt('Categorize these items', {
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
const promptPromise = conversation.prompt('Do a deep analysis', {
  effort: 'RESEARCH',
  signal: ac.signal,
});
ac.abort(); // asks the server to stop the in-flight interaction
await promptPromise;
```

### Stopping a conversation

Use `signal` when the same call site cancels the prompt. When the Stop button
lives elsewhere — a different component, after a reload, or a prompt another
client started — stop the conversation itself. A conversation processes one
run at a time, so no interaction ID is needed. Stopping is best-effort: the
server halts the agent loop and closes the stream, but an LLM turn already in
flight keeps generating server-side and is billed.

```typescript
// Stop whatever is running in a conversation. Returns whether anything was
// actually running.
await space.stopConversation('thread-42');

// Conversation handles stop their own running work.
const thread = space.conversation('thread-42');
await thread.stop();
```

| Method | Description |
| --- | --- |
| `stopConversation(conversationId): Promise<boolean>` | Stop whatever is running in a conversation. |
| `conversation.stop(): Promise<boolean>` | Stop this conversation's running work. |

`stopInteraction(interactionId)` is deprecated: it reaches only a prompt the
server is still awaiting. Use `stopConversation`, which stops the run
regardless of how or where it was started.

## Conversations

Use `space.conversation(id)` for independent histories (for example, multiple chat threads). Conversations are represented as trees: interactions point at a `parentId`, and the SDK tracks an active leaf for each conversation.

```typescript
await conversation.prompt('Hello');

const thread = space.conversation('thread-42');
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
| `space.conversation(id): ConversationHandle` | Get a conversation-scoped handle. |
| `getInteractions(): Interaction[]` | Active branch as a flat list. |
| `getTree(): Record<string, Interaction>` | Full interaction tree. |
| `activeLeafId` | Current branch tip. |
| `setActiveLeaf(id): void` | Switch branches. |
| `getSystemInstruction()` / `setSystemInstruction(value)` | Manage conversation system instruction. Pass `null` to clear. |
| `getConversations(): ConversationMeta[]` | List conversation metadata in the space. |
| `createConversation(agent, visibility): Promise<string>` | Create a conversation under an agent; returns the server-minted conversation ID. |
| `deleteConversation(id): Promise<void>` | Delete a non-active conversation. |
| `conversation.rename(name): Promise<void>` | Rename a specific conversation handle. |

`ConversationHandle` also supports `prompt`, `stop`, `load`, and `applyUpdate` for interaction history.

### Agents

Conversations belong to an agent. Every space has the stock agent `rool`; spaces can also host custom agents. `createConversation` creates a conversation under any agent — including `rool` — with a server-minted ID and the visibility you choose; prompt the returned ID through a normal handle. Stock (`rool`) conversations can also spring into existence from a client-minted ID on first prompt (as in the examples above); custom-agent conversations are only created explicitly.

Each conversation has a visibility: `'shared'` (every space member), `'private'` (only you), or `'temporary'` (private, and auto-deleted after sitting idle). A conversation's agent and visibility are reported on its `ConversationMeta`.

```typescript
const agents = await space.listAgents(); // always includes 'rool'

const id = await space.createConversation('research-bot', 'private');
await space.conversation(id).prompt('Hello');

await space.deleteAgent('research-bot'); // removes the agent and all its conversations
```

| Method | Description |
| --- | --- |
| `listAgents(): Promise<string[]>` | The space's agents. Always includes the stock agent `rool`. |
| `createConversation(agent, visibility): Promise<string>` | Create a conversation under an agent with the given visibility. |
| `deleteAgent(agent): Promise<void>` | Delete a custom agent and all its conversations. The stock agent `rool` cannot be deleted. |

## Schema and Metadata

Collections define the schema visible to the AI agent. Hidden body fields whose names start with `_` are useful for app/UI state that should not be considered by AI.

```typescript
await space.createCollection('article', {
  schemaOrgType: 'Article',
  fields: [
    { name: 'title', type: { kind: 'string' } },
    { name: 'status', type: { kind: 'enum', values: ['draft', 'published'] } },
    { name: 'tags', type: { kind: 'array', inner: { kind: 'string' } } },
    { name: 'author', type: { kind: 'ref' } },
  ],
});

const schema = await space.readSchema();

await space.alterCollection('article', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'status', type: { kind: 'string' } },
]);

await space.writeMeta({ viewport: { x: 0, y: 0, zoom: 1 } });
const meta = await space.readMeta();
```

| Method | Description |
| --- | --- |
| `readSchema(): Promise<SpaceSchema>` | Collection definitions, read from `/space/<name>/.schema.json`. |
| `createCollection(name, fieldsOrDef, options?): Promise<CollectionDef>` | Create a collection. |
| `alterCollection(name, fieldsOrDef, options?): Promise<CollectionDef>` | Replace a collection definition. |
| `dropCollection(name): Promise<void>` | Remove a collection and its object directory. |
| `readMeta(): Promise<Record<string, unknown>>` | Read metadata from `/space/.meta.json`. |
| `writeMeta(meta): Promise<void>` | Write the full metadata blob to `/space/.meta.json`. |

Field kinds: `string`, `number`, `boolean`, `ref`, `enum`, `literal`, `array`, and `maybe`.

## Undo/Redo

Undo/redo works over the whole space. Checkpoints are managed automatically by the server, so you don't need to create them yourself — just call `undo()`/`redo()`.

```typescript
await space.deleteObjects(['/space/article/welcome.json']);

if (await space.canUndo()) {
  await space.undo();
}
```

| Method | Description |
| --- | --- |
| `canUndo(): Promise<boolean>` | Check whether undo is available. |
| `canRedo(): Promise<boolean>` | Check whether redo is available. |
| `undo(): Promise<boolean>` | Restore the latest checkpoint. |
| `redo(): Promise<boolean>` | Reapply undone work. |

Undo/redo availability is scoped to the space.

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
| `webdav.put(path, body, options?)` | Write a file/object at an exact path. Parent collection must exist unless `createParents: true` is passed, which creates missing parent collections atomically (intended for `/rool-drive` paths). |
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
  client: {
    appName: 'com.example.app',
    appVersion: '1.4.2',
    osVersion: 'iOS 17.5',
  },
  logger: console,
});
```

`apiUrl` defaults to `https://api.rool.dev`; `authUrl` is derived by stripping the `api.` hostname prefix unless provided. `baseUrl` is still accepted as a deprecated alias for `apiUrl`. Pass `authProvider` for Node.js, Electron, or custom auth flows.

`client` is optional application identity sent on requests alongside the SDK package name/version. Compatibility is based only on the SDK version.

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
| `generateId(): string` | Generate a unique ID suitable for conversation IDs. |

### Client events

```typescript
client.on('authStateChanged', (authenticated) => void 0);
client.on('currentUserChanged', (user) => void 0); // CurrentUser | null; null on sign-out
client.on('spaceAdded', (space) => void 0);
client.on('spaceRemoved', (spaceId) => void 0);
client.on('spaceRenamed', (spaceId, newName) => void 0);
client.on('userStorageChanged', ({ key, value, source }) => void 0);
client.on('connectionStateChanged', (state) => void 0);
client.on('error', (error, context) => void 0);
client.on('serverInfoChanged', (info) => void 0);
client.on('unsupported', (info) => void 0); // SDK older than server minimum
```

## RoolSpace API

Properties: `id`, `name`, `role`, `memberCount`, `conversations`, `route`, `webdav`.

| Method | Description |
| --- | --- |
| `conversation(conversationId): ConversationHandle` | Get a conversation-scoped handle. |
| `getObject`, `getObjects`, `stat` | Read object data and stats. |
| `getConversations`, `createConversation`, `deleteConversation` | List, create, and delete conversations. |
| `listAgents`, `deleteAgent` | List the space's agents and delete a custom agent. |
| `getMetadata`, `getAllMetadata`, `getSchema` | Read metadata and schema. |
| `canUndo`, `canRedo`, `undo`, `redo` | Space history controls. |
| `stopConversation(conversationId): Promise<boolean>` | Stop whatever is running in a conversation. |
| `fetch(url, init?): Promise<Response>` | Proxy an external HTTP request through the server to bypass browser CORS. |
| `close(): void` | Stop the space subscription. |
| `rename(newName): Promise<void>` | Rename the space. |
| `delete(): Promise<void>` | Permanently delete the space. |
| `listUsers(): Promise<SpaceMember[]>` | List collaborators. |
| `setUserRole(userId, role): Promise<void>` | Change an existing member's role. |
| `removeUser(userId): Promise<void>` | Remove collaborator. |
| `createInvite(role, options?): Promise<SpaceInviteCreated>` | Mint an invite link; `options` takes `email`, `expiresInDays`, `maxUses`. |
| `listInvites(): Promise<SpaceInvite[]>` | List currently redeemable invites. |
| `revokeInvite(inviteId): Promise<boolean>` | Revoke an invite so its link stops working. |
| `exportArchive(): Promise<Blob>` | Export a space archive. |
| `refresh(): Promise<void>` | Refresh cached space data. |
| `fetchPath(path, options?): Promise<Response>` | Fetch a `/rool-drive/...` file. |
| `getStorageUsage(): Promise<SpaceFileStorageUsage>` | File-storage quota usage. |

Events:

```typescript
space.on('metadataUpdated', ({ metadata, source }) => void 0);
space.on('schemaUpdated', ({ schema, source }) => void 0);
space.on('conversationUpdated', ({ conversationId, source }) => void 0);
space.on('reset', ({ source }) => void 0);
space.on('syncError', (error) => void 0);
space.on('filesChanged', ({ spaceId, source, timestamp }) => void 0);
space.on('filesReset', ({ spaceId, source, timestamp }) => void 0);
space.on('connectionStateChanged', (state) => void 0);
```
## Import/Export

```typescript
const archive = await space.exportArchive();
const imported = await client.importArchive('Imported Data', archive);
```

Archives include objects, metadata, conversations, and file storage.

## Data Types

```typescript
// Outcome of signInWithPassword. 'verify_required' means the account's email
// isn't verified yet and the server has emailed a magic link.
type PasswordSignInResult = { status: 'signed_in' | 'verify_required' };

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

// Who may see a conversation: 'shared' is every space member; 'private' is
// owner-only; 'temporary' is private plus auto-delete once it sits idle.
type ConversationVisibility = 'shared' | 'private' | 'temporary';

// Lightweight conversation roster entry (no interaction bodies), from
// getConversations(). `updatedAt` drives last-activity display.
interface ConversationMeta {
  id: string;
  agent: string; // owning agent ('rool' is the stock agent)
  visibility: ConversationVisibility;
  name: string | null;
  systemInstruction: string | null;
  createdAt: number;
  createdBy: string;
  interactionCount: number;
  updatedAt: number;
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

// Outcome of the invite email send. Null when no email was involved (open link).
// The invite is always minted and its `url` is usable regardless of this value;
// only the email delivery is reflected here.
// - 'sent': email dispatched
// - 'not_configured': server has no mail provider (local dev)
// - 'failed': provider rejected the send
// - 'cooldown': a recent invite to this same address was already emailed
// - 'rate_limited': the inviter hit their daily email-invite cap
// Treat unknown values as not sent.
type InviteEmailStatus =
  | 'sent'
  | 'not_configured'
  | 'failed'
  | 'cooldown'
  | 'rate_limited'
  | (string & {});

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
  // Deprecated: object audit info is no longer carried by openSpace. Read file
  // timestamps via WebDAV (sync-collection / PROPFIND getlastmodified) instead.
  path: string;
  modifiedAt: number;
  modifiedBy: string;
  modifiedByName: string | null;
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
