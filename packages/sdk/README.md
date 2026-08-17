# Rool SDK

TypeScript SDK for Rool Machines.

## Installation

```bash
npm install @rool-dev/sdk
```

## User and session API

```typescript
import { RoolClient } from "@rool-dev/sdk";

const client = new RoolClient({
  getTokens: () => ({
    accessToken: currentAccessToken,
    roolToken: currentRoolToken,
  }),
});

const session = await client.getSession();
const account = await client.getAccount();
const profile = await client.getProfile();
const userAppData = await client.getUserAppData();
const greeting = await client.getGreeting("en");

await client.replaceProfile({
  name: "Ada",
  marketingOptIn: true,
});
await client.setUserAppData("theme", "dark");
await client.deleteUserAppData("theme");
await client.deleteAccount();
```

`UserAppData` is an opaque cross-device JSON object. App data is changed one key at a time so unrelated settings cannot overwrite each other.

## Account events

```typescript
const unsubscribe = client.events.subscribe(async (event) => {
  if (event.type === "session") {
    renderSession(event.session);
  } else if (event.type === "account_changed") {
    renderAccount(await client.getAccount());
  } else if (event.type === "profile_changed") {
    renderProfile(await client.getProfile());
  } else if (event.type === "user_app_data_changed") {
    renderUserAppData(await client.getUserAppData());
  } else if (event.type === "machines_changed") {
    renderMachines(await client.listMachines());
  } else if (event.type === "machine_members_changed") {
    renderMembers(
      event.machineId,
      await client.machine(event.machineId).members.list(),
    );
  }
});

unsubscribe();
```

Account events tell the client when something changed. Fetch the relevant route to get the latest data. The SDK starts with `/v2/session`, then long-polls for changes using its account sync token. Empty polls and network retries do not produce events or refresh the session. If a token expires, the SDK fetches a new session and sends another `session` event.

`getTokens` may return tokens synchronously or asynchronously. The SDK sends the access token as `Authorization: Bearer …` and the Rool token as `X-Rool-Token`. Bearer-only integrations can use `getAccessToken` instead. Use `apiUrl` to target a non-production server and `fetch` to provide a custom transport.

## Authentication

Auth clients own login, credential storage, and refresh. `RoolClient` only asks one for tokens and tells it when authentication is invalidated.

### Browser authentication

```typescript
import { BrowserAuth, RoolClient } from "@rool-dev/sdk";

const auth = new BrowserAuth();
const client = new RoolClient({
  getTokens: auth.getTokens,
  onAuthInvalidated: auth.logout,
});

auth.onAuthStateChanged(renderSignedInState);
if (!(await auth.initialize())) {
  await auth.login("My App");
}
```

`initialize()` processes an auth callback in the URL. Tokens are stored in endpoint-scoped browser storage and refreshed when requested.

### Native authentication

`NativeAuth` uses system-browser PKCE for Google and Apple while also supporting password and magic-link sign-in.

```typescript
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { NativeAuth, RoolClient } from "@rool-dev/sdk";

const auth = new NativeAuth({
  redirectUri: "roolandroidauth://auth/callback",
  defaultProvider: "google",
  openExternal: (url) => Browser.open({ url }),
});
const client = new RoolClient({
  getTokens: auth.getTokens,
  onAuthInvalidated: auth.logout,
});

App.addListener("appUrlOpen", async ({ url }) => {
  await Browser.close();
  await auth.handleRedirect(url);
});

if (!(await auth.initialize())) await auth.login("My App");
```

The redirect URI must exactly match the app setup and auth server allowlist. Pass `{ provider: "apple" }` to `login()` or `signup()` to override the default provider.

```typescript
const result = await auth.signInWithPassword(email, password);
if (result.status === "verify_required") showCheckYourEmailMessage();

await auth.requestMagicLink(email);
await auth.verify(verifyToken);
```

On native, an HTTPS magic link only returns to the app when Universal Links or App Links are configured for that domain.

### Password and account methods

Browser and native auth clients also provide:

- `setPassword(password)`
- `requestEmailChange(newEmail)`
- `verify(token)`
- `logout()`
- `isAuthenticated()`

### Node.js authentication

```typescript
import { RoolClient } from "@rool-dev/sdk";
import { NodeAuth } from "@rool-dev/sdk/node";

const auth = new NodeAuth();
if (!(await auth.initialize())) await auth.login("My CLI");

const client = new RoolClient({
  getTokens: auth.getTokens,
  onAuthInvalidated: auth.logout,
});
```

`NodeAuth` opens the system browser for login and stores endpoint-scoped credentials under `~/.config/rool/`. It refreshes the access and Rool tokens when requested. Pass `apiUrl` to select another deployed environment; the corresponding auth URL is derived from it. When the API uses a loopback URL, pass `authUrl` explicitly.

Use `profile` or `credentialsPath` when an application needs multiple independent accounts:

```typescript
const auth = new NodeAuth({
  apiUrl: "https://api.example.com",
  profile: "automation",
});
```

API errors are thrown as `RoolProblem` with the server's stable `code`, HTTP `status`, `title`, and `detail`.

## Machine API

```typescript
const created = await client.createMachine({ name: "Research" });
const machine = client.machine(created.id);

const details = await machine.get();
await machine.settings.replace({ name: "Field research" });
const copy = await machine.duplicate({ name: "Research copy" });
const response = await machine.fetchUrl("https://example.com/data.json");
await client.machine(copy.id).delete();
```

`client.machine(id)` returns a stable machine handle that owns machine-scoped APIs and synchronization state. Creation, listing, sessions, duplication, and `machine.get()` all return the same point-in-time `MachineSummary`; bind its ID to a handle before performing machine operations. Summaries include the machine's inbound email address, lifecycle `state`, and an opaque `meta` JSON object. `fetchUrl()` returns the upstream `Response`, including non-success statuses.

## Machine checkpoints

```typescript
const history = await machine.checkpoints.list();
const checkpoint = history.checkpoints.at(-1);
if (checkpoint) {
  await machine.checkpoints.restore(checkpoint.id);
}
```

The checkpoint collection contains the currently restorable timeline and the `baseCheckpointId` underlying the live filesystem. The live filesystem can contain newer uncheckpointed changes. Restoring a checkpoint preserves those changes as a new checkpoint and causes a watched machine file tree to reconcile completely. Moving backward does not discard later checkpoints, but modifying the filesystem from that earlier position replaces the later timeline.

## Machine files

```typescript
const files = machine.files;
const path = "/rool-drive/documents/report.pdf";

const storage = await files.getStorageUsage();
console.log(storage.usedBytes, storage.availableBytes);
await files.createDirectory("/rool-drive/documents");
const written = await files.write(path, reportBlob, {
  contentType: "application/pdf",
  ifNoneMatch: "*",
  onUploadProgress: ({ transferredBytes, totalBytes }) => {
    if (totalBytes) renderUploadProgress(transferredBytes / totalBytes);
  },
});
await files.write(
  "/rool-drive/documents/archive.bin",
  () => createArchiveStream(),
  { contentType: "application/octet-stream" },
);
const info = await files.stat(path);
const documents = await files.list("/rool-drive/documents");
const response = await files.read(path, {
  range: { start: 0, end: 1023 },
  ifMatch: info.etag,
});
const hydrated = await files.readMultiple([
  "/space/.meta.json",
  "/rool-drive/documents/notes.json",
]);
await files.copy(path, "/rool-drive/documents/report-backup.pdf", {
  overwrite: false,
  ifMatch: written.etag,
});
await files.move(path, "/rool-drive/documents/final-report.pdf");
const deleted = await files.deleteMultiple([
  "/rool-drive/documents/final-report.pdf",
  { path: "/rool-drive/documents/notes.json", ifMatch: '"notes-etag"' },
]);
for (const result of deleted) {
  if (!result.ok)
    console.error(`Failed to delete ${result.path}`, result.error);
}
```

Paths are absolute machine paths under `/space` or `/rool-drive`. `list()` without a path enumerates those storage roots; pass `{ recursive: true }` to enumerate a complete subtree. File and directory metadata has a discriminating `kind` field. Reads return the native `Response` so callers can stream the body. `readMultiple()` hydrates ordered small files in one request and returns an `ok` result with binary-safe bytes and validators, or a per-file HTTP failure. A batch accepts at most 128 paths, 2 MiB per successful file, and 16 MiB across successful files. Writes accept any `BodyInit`, including `Blob` and `ReadableStream`, and return the same complete file metadata as `stat()` and `list()`. Pass a function that creates a fresh `ReadableStream` when an upload must be replayable after a machine route change; a directly passed stream remains one-shot. `onUploadProgress` reports transferred bytes and includes the total size when it is known; successful completion is confirmed by the `write()` promise. Copy and move operations overwrite by default; pass `{ overwrite: false }` for create-only behavior.

`deleteMultiple()` sends independent DAV requests with at most eight in flight. It accepts plain paths and targets carrying their own HTTP preconditions, and returns one ordered success or failure result per target. The requests are not atomic. A directory target recursively deletes its contents, so callers should omit redundant descendants; duplicate and overlapping targets otherwise remain independent and can race.

Every file and directory has protected `access` metadata. `currentUser` says whether the requesting user can read or write it. `readableBy` and `writableBy` describe its filesystem audiences as `resource-owner`, `machine-admins`, `machine-editors`, and `machine-members`. For a file, write means changing its contents. For a directory, write means adding, removing, or renaming entries. Members without read access to a directory do not receive that directory through listing, direct lookup, or synchronization.

`getStorageUsage()` reports the used and writable bytes on the machine's complete live persistent filesystem, including public files and private runtime or system state. It excludes checkpoint history and the ephemeral operating-system overlay.

Watch the files when an application needs a live machine file tree:

```typescript
await files.watch();

const unsubscribe = files.tree.subscribe(({ reset, changed, deleted }) => {
  renderFileChanges({ reset, changed, deleted });
});

const cached = files.tree.get("/rool-drive/documents/final-report.pdf");
const etag = files.tree.etag("/rool-drive/documents/final-report.pdf");
const allDocuments = files.tree.list("/rool-drive/documents", {
  recursive: true,
});

unsubscribe();
files.unwatch();
```

`files.watch()` performs a complete `sync-collection`, then keeps the machine's file metadata and ETag cache current with long-poll incremental reports. DAV writes and guest-program changes enter the same tree. An invalid or expired sync token causes an atomic complete reconciliation and a change event with `reset: true`. Transient sync errors are retried and available as `files.watchError`; `files.unwatch()` aborts the active long poll.

## Rool Object Collections

Objects are JSON stored under `/space`. Collections are directories with a `.schema.json` definition and objects are schema-checked JSON files.

```typescript
await machine.files.watch();

const task = await machine.collections.create("task", {
  fields: [
    { name: "title", type: { kind: "string" } },
    { name: "done", type: { kind: "boolean" } },
  ],
});

const first = await machine.objects.create("/space/task/first.json", {
  title: "First task",
  done: false,
});
const objectPaths = machine.objects.list({ collection: "task" });
const object = await machine.objects.get(first.path);
const [sameObject, missing] = await machine.objects.getMultiple([
  first.path,
  "/space/task/missing.json",
]);

await machine.objects.patch(first.path, { done: true });
await machine.objects.move(first.path, "/space/task/renamed.json");
const [removal] = await machine.objects.removeMultiple([
  "/space/task/renamed.json",
]);
if (!removal) throw new Error("Object removal returned no result");
if (!removal.ok) throw removal.error;
await machine.collections.remove(task.name);
```

`machine.objects.list()` returns object paths from the synchronized file tree without reading their bodies. `get()` reads one object and `getMultiple()` preserves the input positions and returns `undefined` for missing objects. Every call reads the current bodies from DAV, with multiple reads using bounded `read-multiple` batches. Collection schemas are read in the same way and schema replacement follows the guest's lazy-migration rule: existing objects are checked again only when edited.

Creates are create-only. Metadata, schema, and object replacements plus object patches, moves, and removals use ETags and report status `412` when state changed concurrently. `removeMultiple()` uses a separate conditional DAV request for each object and returns ordered per-object results. Removing a collection recursively deletes its contents. Object moves do not overwrite by default; pass `{ overwrite: true }` explicitly. Patch values of `null` or `undefined` remove fields.

The semantic APIs use the machine's shared file tree and sync loop. They do not create separate synchronization state. Body reads and mutations also work without `machine.files.watch()` by reading current DAV state directly; `objects.list()` reflects the shared file tree, so watch the machine's files before enumerating paths.

## Agents

Agents and conversations use stable JSON routes; their private machine files are not part of the SDK. Prompting does not require `machine.files.watch()`.

```typescript
const defaultAgent = await machine.agents.get("rool");
if (!defaultAgent) throw new Error("Rool agent is unavailable");

const conversation = defaultAgent.conversation("research-chat");
const stopWatching = conversation.watch((view) => {
  renderConversation({
    turns: view.turns,
    output: view.output,
    isRunning: view.isRunning,
    loading: view.loading,
    error: view.error,
  });
});

await conversation.prompt("Explain the result.", { effort: "reasoning" });

// When this conversation leaves the UI:
stopWatching();
```

`prompt()` starts the conversation's current run and resolves once the server accepts it. The agent runs as a detached job. A conversation can only have one current run; call `cancel()` and wait for `follow()` to finish before prompting again. The `readOnly` option is accepted for compatibility with legacy prompting but currently has no effect.

`watch()` is the normal UI API. It fetches only turns after the last turn it has seen, follows the current run, and refreshes the durable turns when that stream ends. `turns` contains saved history through the current user message while a run is active; `output` contains that run's replayed and live output. The first listener starts the work and removing the last listener stops it. Saved turns remain cached on the conversation handle for the next listener.

`follow()` is the lower-level streaming API. It performs one `GET` of the conversation's current run. It receives the complete current-run output and then continues with new events until that response ends. Tool calls and their results arrive as `output.delta` events with matching IDs. A tool result contains nested content parts and an optional `error` flag. `follow()` returns `false` when there is no current run. Aborting `follow()` only stops that request; call `cancel()` to stop the detached job.

The SDK uses `conversation_changed` account events to wake active watchers. A watcher also refreshes after prompting, cancellation, stream completion, connection failure, and account event-token replacement.

Prompt attachments are existing `/space` or `/rool-drive` paths. Pass a durable user turn's `id` as `replaceTurnId` to replace that message and everything after it. This supports edits and rerolls, including the first message. A replacement gets a new user turn ID; use that ID to edit it again.

Pass a JSON Schema as `responseSchema` to request structured output. Tools are skipped for that run. The successful assistant turn contains one JSON content part; the value is JSON directly, not a JSON string.

```typescript
await conversation.prompt("Return the number of records.", {
  responseSchema: {
    type: "object",
    properties: { count: { type: "integer" } },
    required: ["count"],
    additionalProperties: false,
  },
});
await conversation.follow();

const turns = await conversation.listTurns();
const part = turns.at(-1)?.content[0];
if (part?.type !== "json") throw new Error("No structured result");
console.log(part.value); // { count: ... }
```

A custom agent's `system` field contains instructions added after Rool's built-in machine context. Each conversation can add another instruction layer without changing the agent or its metadata.

```typescript
const researcher = await machine.agents.create("researcher", {
  system: "Investigate carefully and distinguish facts from uncertainty.",
});
const customConversation = await researcher.createConversation({
  name: "Climate report",
  visibility: "private",
});
await customConversation.replaceInstructions(
  "For this conversation, compare at least two sources.",
);
await customConversation.prompt("Investigate this claim.");
```

`getInstructions()` returns the conversation instructions. `replaceInstructions("")` clears them. Metadata changes do not affect them. New instructions apply to the next run; a run already in progress keeps the instructions it started with.

Agents expose `replace()` and `delete()`. Conversations expose instruction and metadata replacement, listing, durable turn reads, rename, and deletion. Listed and fetched conversation metadata includes server-managed ISO 8601 `createdAt` and `updatedAt` timestamps plus `isRunning`, which can drive a running indicator without opening every run stream. Visibility defaults to private. The built-in `rool` agent cannot be replaced or deleted.

## Members and invites

```typescript
const invite = await machine.invites.create({
  role: "editor",
  maxUses: 1,
});
const token = invite.url.split("/").at(-1)!;

await client.getInvitePreview(token);
await client.redeemInvite(token);

const members = await machine.members.list();
console.log(members[1].name ?? members[1].email);
await machine.members.replaceRole(members[1].userId, { role: "viewer" });
await machine.members.remove(members[1].userId);
await machine.invites.revoke(invite.id);
```

Invite URLs contain a secret token and are returned only when an invite is created. Invites can optionally be bound to an email address. Role replacement never creates membership or transfers ownership.

## Gifts

A gift carries something of value in a short code. Users receive gifts from Rool and give the codes away themselves. Claiming a gift is single-use, and claiming your own gift is allowed.

```typescript
const { gifts } = await client.listGifts();
for (const gift of gifts) {
  console.log(gift.code, gift.url, gift.description, gift.claimedAt);
}

const preview = await client.previewGift(code); // no auth required
console.log(
  `${preview.holderName ?? "Someone"} gave you ${preview.description}`,
);

const { gift } = await client.claimGift(code);
if (gift.kind === "credits") console.log(`+${gift.credits} credits`);
```

Codes are case-insensitive and the dash is optional. Prefer the server-rendered `description` for display. Narrow `gift.kind` when using the structured payload because new gift kinds may be added.

A holder can add a note, archive a gift, or replace an unclaimed gift's code. These actions do not change what the gift grants. Archiving only hides it from the holder's normal view.

```typescript
await client.updateGift(giftId, { note: "sent to Peter" });
await client.updateGift(giftId, { archived: true });
await client.updateGift(giftId, { note: null });
const updated = await client.rotateGiftCode(giftId);
```

Gift failures are `RoolProblem` errors. `gift_invalid` means the code or gift is unavailable to the caller. `gift_claimed` means it was already claimed.

## Speechmatics

Voice input transcribes the user's speech with Speechmatics' real-time API. Rool mints a short-lived key without exposing its long-lived provider key; hand the temporary key to the Speechmatics real-time SDK and stream the user's mic audio to it.

```typescript
const { token, expiresAt, ttl } = await client.getSpeechmaticsToken({
  ttl: 300,
});
// speechmaticsRealtimeClient.start(token, { transcription_config: { language: "en" } })
```

The key expires after `ttl` seconds (60–3600, default 300). `expiresAt` is the epoch-milliseconds moment the key stops being accepted. A token request fails with `insufficient_credits` when the account's balance is too low and with `speechmatics_unavailable` when Speechmatics cannot issue a key.

## API problems

Each problem `type` links to its entry below.

<a id="problem-authentication_required"></a>

### `authentication_required`

**Documentation placeholder.**

<a id="problem-invalid_authentication"></a>

### `invalid_authentication`

**Documentation placeholder.**

<a id="problem-email_unverified"></a>

### `email_unverified`

**Documentation placeholder.**

<a id="problem-account_suspended"></a>

### `account_suspended`

**Documentation placeholder.**

<a id="problem-invalid_profile"></a>

### `invalid_profile`

**Documentation placeholder.**

<a id="problem-invalid_user_app_data"></a>

### `invalid_user_app_data`

**Documentation placeholder.**

<a id="problem-invalid_json"></a>

### `invalid_json`

**Documentation placeholder.**

<a id="problem-payload_too_large"></a>

### `payload_too_large`

**Documentation placeholder.**

<a id="problem-user_app_data_too_large"></a>

### `user_app_data_too_large`

**Documentation placeholder.**

<a id="problem-not_found"></a>

### `not_found`

**Documentation placeholder.**

<a id="problem-checkpoint_not_found"></a>

### `checkpoint_not_found`

**Documentation placeholder.**

<a id="problem-sync_token_required"></a>

### `sync_token_required`

The account event route requires the sync token returned by `/v2/session`.

<a id="problem-invalid_sync_token"></a>

### `invalid_sync_token`

The account event history no longer contains everything after this token. Fetch `/v2/session` and continue with its new token.

<a id="problem-invalid_wait_preference"></a>

### `invalid_wait_preference`

The account event wait must be an integer from 0 through 50 seconds.

<a id="problem-internal_error"></a>

### `internal_error`

**Documentation placeholder.**

<a id="problem-server_misconfigured"></a>

### `server_misconfigured`

**Documentation placeholder.**

<a id="problem-current_run_exists"></a>

### `current_run_exists`

The conversation is already running. Cancel or follow that run before prompting again. This also applies to prompts with `replaceTurnId`.

<a id="problem-replace_turn_not_found"></a>

### `replace_turn_not_found`

The user turn supplied as `replaceTurnId` is no longer in the conversation. Fetch the turns again before retrying the edit.

<a id="problem-invalid_member_role"></a>

### `invalid_member_role`

**Documentation placeholder.**

<a id="problem-role_not_replaceable"></a>

### `role_not_replaceable`

**Documentation placeholder.**

<a id="problem-membership_not_removable"></a>

### `membership_not_removable`

**Documentation placeholder.**

<a id="problem-invalid_invite"></a>

### `invalid_invite`

**Documentation placeholder.**

<a id="problem-invite_invalid"></a>

### `invite_invalid`

**Documentation placeholder.**

<a id="problem-invite_expired"></a>

### `invite_expired`

**Documentation placeholder.**

<a id="problem-invite_revoked"></a>

### `invite_revoked`

**Documentation placeholder.**

<a id="problem-invite_exhausted"></a>

### `invite_exhausted`

**Documentation placeholder.**

<a id="problem-invite_email_mismatch"></a>

### `invite_email_mismatch`

**Documentation placeholder.**

<a id="problem-gift_invalid"></a>

### `gift_invalid`

The code is not valid, or the requested gift does not belong to the current user.

<a id="problem-gift_claimed"></a>

### `gift_claimed`

The gift has already been claimed. A claimed gift cannot be claimed again or given a new code.

<a id="problem-invalid_input"></a>

### `invalid_input`

The gift update is empty or contains an invalid note or archived value.

<a id="problem-insufficient_credits"></a>

### `insufficient_credits`

The account's credit balance is too low to mint a speech transcription key. Top up the balance and try again.

<a id="problem-speechmatics_unavailable"></a>

### `speechmatics_unavailable`

Speechmatics could not issue a transcription key right now. Try again shortly.

## Development

```bash
pnpm build
pnpm typecheck
```

The user-route smoke test must target a dedicated non-production account. It replaces profile and app data, then schedules and cancels account deletion. The member-route smoke test requires a second non-production account to exercise invite redemption and membership changes. The local gift fixture accounts are deleted after the gift smoke test.

Copy `.env.example` to the ignored `.env` file and configure the local endpoints and expected primary account ID.

| Variable                        | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `ROOL_TEST_API_URL`             | API origin. HTTPS is required except for loopback development servers. |
| `ROOL_TEST_AUTH_URL`            | Auth endpoint override required for a loopback API.                    |
| `ROOL_TEST_ROUTER_URL`          | Local machine-router origin.                                           |
| `ROOL_TEST_USER_ID`             | Expected primary account ID, preventing mutation of the wrong account. |
| `ROOL_TEST_GIFT_HOLDER_EMAIL`   | Local fixture account that holds a gift.                               |
| `ROOL_TEST_GIFT_CLAIMANT_EMAIL` | Local fixture account that claims the gift.                            |
| `ROOL_TEST_INTERNAL_SECRET`     | Local rool-server secret used to create and remove fixtures.           |

Log the `sdk-v2-primary` and `sdk-v2-member` Node profiles into two dedicated accounts:

```bash
node --env-file=.env --import tsx test/integration/v2/login.ts
```

Then run the complete v2 smoke-test suite:

```bash
pnpm test:v2
```

To run one smoke test manually, invoke its script directly, for example:

```bash
node --env-file=.env --import tsx test/integration/v2/machine-routes.test.ts
```

## License

MIT — see [LICENSE](../../LICENSE).
