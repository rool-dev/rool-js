---
title: Machines and sharing
---

A machine handle groups everything that belongs to one persistent VM: settings, files, agents, structured data, checkpoints, and sharing.

```typescript
const created = await client.createMachine({ name: "Research" });
const machine = client.machine(created.id);
```

`createMachine()` puts the machine on the user's home account unless `accountId` names a team they are an admin of; a member of the team gets `account_admin_required`. `client.machine()` only creates or reuses a local handle; it does not check the server. Call `machine.get()` when you need the latest summary. Use `listMachines()` to refresh the machines visible to the user.

## Lifecycle

Machine settings currently contain the name and are replaced as a whole. A machine also has a globally unique hostname used for a variety of public facing features. Set it with `machine.setHostname("research-notes")`. Hostnames contain 1 to 30 lowercase letters, numbers, or hyphens, cannot start or end with a hyphen, and cannot use a reserved name. Machine summaries include the resulting external [WebDAV endpoint](/files/#connect-an-external-webdav-client) as `webDavUrl`.

`duplicate()` copies the machine's current files and conversations into an independent machine owned only by the person making the copy. Sharing does not carry over. The copy goes to the account that pays for the person's work on the original, unless `accountId` says otherwise, and the person must be an admin of that account (`account_admin_required`): a team's member copying its machine names their home account. On a team the copy takes the original's `type` unless one is given.

`machine.move(accountId)` moves a machine to another account. It takes an admin of both accounts. When the two accounts are on different plans, the move stops the machine, so requests running in it fail with `machine_stopped`. The new plan sets its hardware when it next starts, except that a machine moving into a team keeps the type it has, so the team's balance must cover its rent (`insufficient_balance`).

Rool creates filesystem checkpoints automatically, about every 30 seconds while the machine is writing. Older ones are thinned out to one per hour, then one per day, then one per month. `machine.checkpoints.list()` returns every restorable checkpoint, oldest first.

`machine.checkpoints.restore(id)` returns the whole machine (files, conversations and objects, for every member) to that checkpoint. A restore never discards history. Unsaved changes are saved as a checkpoint first, and the restored state is added as the newest checkpoint, with `restoredFrom` set to the time of the checkpoint it came from. The result's `replacedCheckpointId` is the state the restore replaced, marked `preRestore` in the list. Restore it to undo the restore. A watched file tree resets itself after a restore.

```typescript
const checkpoints = await machine.checkpoints.list();
const { replacedCheckpointId } = await machine.checkpoints.restore(
  checkpoints[0].id,
);

// Changed your mind:
if (replacedCheckpointId)
  await machine.checkpoints.restore(replacedCheckpointId);
```

Deleting a machine requires its owner, or an admin of the account that pays for it, and stops any file watch held by that handle. An account's admins can also make any member the owner, with `members.replaceRole(userId, { role: "owner" })`, and put themselves on any of its machines.

## Power and resources

A machine starts when something needs it and stops on its own when idle. `machine.stop()` shuts it down now, after saving its state. Owners, admins and editors can stop a machine. The next request that needs the machine starts it again. A request that is running in the machine when it stops, whether through `stop()`, a restore or going idle, fails with the problem code `machine_stopped` and can be retried.

`machine.getResources()` reports the machine's CPU and memory as the machine itself sees them. Reading it never starts a stopped machine, which then reports `{ running: false }`, and it does not keep a running one awake. CPU time is cumulative, so compute load from two readings:

```typescript
const a = await machine.getResources();
await new Promise((resolve) => setTimeout(resolve, 2_000));
const b = await machine.getResources();
if (a.running && b.running) {
  const load =
    (b.cpuBusySeconds - a.cpuBusySeconds) /
    ((b.uptimeSeconds - a.uptimeSeconds) * b.vcpus);
  const memoryUsed = 1 - b.memAvailableBytes / b.memTotalBytes;
}
```

`uptimeSeconds` exists for that formula and does not say how long the machine has been up. A machine that does not answer in time fails with `machine_unavailable`; try again shortly.

`machine.getStorage()` reports disk usage against the owner's plan, split into files, conversations, objects, home folders and other. While usage is over the plan, `graceEndsAt` gives the time writes stop; they resume once usage is back under. It replaces the deprecated `machine.files.getStorageUsage()`.

`machine.fetchUrl()` fetches a public HTTP or HTTPS URL through Rool and returns a normal `Response`. Non-success HTTP responses are returned rather than thrown, while private network destinations are blocked.

## Run Linux commands

`machine.exec()` runs a Bash command as the authenticated member's Linux user. The caller must be an owner or admin. It does not grant root privileges.

```typescript
import type { MachineExecResult } from "@rool-dev/sdk";

const result: MachineExecResult = await machine.exec({
  command:
    "cd /rool-drive && python3 -c 'import sys; print(sys.stdin.read().upper())'",
  stdin: "Hello from the SDK!\n",
  timeoutMs: 30_000,
});

console.log(result.stdout);
console.log(result.stderr);
console.log(result.exitCode, result.durationMs);
```

Each request starts a new shell in the member's home directory. Use `cd` in the command when you want a different directory. Shell variables and directory changes do not carry over to subsequent calls. There is no PTY and no interactive input.

`exec()` collects the output as text and returns it when the command finishes. To receive output while the command runs, or to receive bytes that are not text, use `execStream()` with the same options:

```typescript
for await (const event of machine.execStream({ command: "make test" })) {
  if (event.type === "stdout") process.stdout.write(event.data);
  if (event.type === "stderr") process.stderr.write(event.data);
  if (event.type === "exit") console.log(event.exitCode, event.durationMs);
}
```

`stdout` and `stderr` events carry a `Uint8Array` and arrive in the order the command wrote them. The `exit` event is always the last one.

The server defaults to a 30-second execution timeout and clamps an explicit `timeoutMs` to 1,000–350,000 milliseconds. A command that reaches its timeout is ended: the reason is added to stderr, the exit code is `-1`, and the output it produced until then is kept. `stdin` is optional UTF-8 text. Nonzero command exit codes resolve normally as `MachineExecResult`; HTTP failures such as permission or request-validation errors reject with `RoolProblem`. A command that could not be started, a reply that ends before the exit, and network errors also reject, and the SDK does not automatically repeat a command after a failure.

An optional `signal: AbortSignal` cancels the request. A command given no `stdin` is then ended in the machine; a command with `stdin` runs until it finishes or reaches its timeout. The optional `asUserId` field is reserved for superadmins executing as another existing machine member; regular callers should omit it.

This requires SDK 2.0.9 or later. `exec()` in earlier versions no longer works.

The command is Bash source. Pass untrusted text through `stdin` rather than interpolating it into the command.

## Remote MCP connections

### Connect a provider

Owners and admins can connect a machine to a provider. List the providers available to the signed-in user and let them choose one:

```typescript
const providers = await client.listMcpProviders();
renderProviders(providers);

async function connectProvider(providerId: string) {
  const authorization =
    await machine.mcpProviders.startAuthorization(providerId);
  window.open(authorization.authorizationUrl, "_blank");
}
```

Each provider has `id`, `name`, `description`, and `logoUrl`. The description explains which services it connects. Providers are currently staff-only during preview, so other users receive an empty list.

Authorization returns a consent URL and `expiresAt`. No connection exists yet: after consent, the backend creates the connections allowed by the granted permissions. Use `machine.mcpConnections.watch()` to receive the updated list. Do not call `mcpConnections.create()` first or wait for a particular connection ID.

### Connect a custom server

For a custom remote HTTPS MCP server, authentication is explicit: choose no authentication, supply HTTP headers, or choose OAuth.

```typescript
const connection = await machine.mcpConnections.create({
  name: "notion",
  description: "Company documents and notes",
  url: "https://mcp.notion.com/mcp",
  authentication: { type: "oauth" },
});

const authorization = await machine.mcpConnections.startAuthorization(
  connection.id,
);
window.open(authorization.authorizationUrl, "_blank");
```

The optional `description` is limited to 160 characters after whitespace is collapsed and trimmed. Nonempty descriptions are returned on connections.

Supply the full HTTPS endpoint as `url` when creating a connection. Returned connections expose only `hostname` (for example, `mcp.notion.com`), never the full endpoint. The deprecated response field `url` also contains only that hostname.

Watch the collection while showing connection state. The watcher loads it immediately, refreshes it after OAuth completion and other changes, and handles account-session resets. It coalesces changes that arrive together, so do not poll `get()` while authorization is open.

```typescript
const stopWatching = machine.mcpConnections.watch((view) => {
  renderConnections(view.connections, view.loading, view.error);
});

// When the view no longer needs live updates
stopWatching();
```

Stored header values, OAuth client secrets, and tokens are never returned; summaries contain only header names and authorization state. Use `replaceAuthentication()`, `clearAuthorization()`, or `remove()` to manage an existing connection.

## Members and invites

The four machine roles are deliberately simple:

- **owner** — full control, including deletion
- **admin** — can edit the machine and manage its members and invites
- **editor** — can change files and run agents
- **viewer** — can read shared machine data

Owners and admins create either a shareable link or an email invite with `machine.invites.create()`. An invite chooses the new member's role and can limit its lifetime or number of uses. Keep the returned `url`; listed invites intentionally do not reveal it again.

An app can preview an invite before sign-in with `client.getInvitePreview(token)`. After sign-in, `client.redeemInvite(token)` adds or updates the member. Admins can list and revoke invites, change member roles, and remove members. Any non-owner member can also remove themselves; ownership cannot be assigned through the role API. On a team machine, `members.replaceRole(userId, { role })` on a member of the team who is not yet on the machine adds them outright, with no invite to accept: joining the team was the acceptance. For anyone else it fails with `invite_required`. The reverse holds for machine invites: creating one for an email that is on the paying team's roster, or on one of its open team invites, fails with `account_member`; add them, or put the machine on their team invite. `members.pending()` lists, for machine admins and the paying team's admins, the takers of open team invites that put them on the machine.

## Search a machine

Search chats, ordinary files, and structured objects through one API:

```ts
const machine = client.machine(machineId);
const abortController = new AbortController();
const page = await machine.search({
  query: "annual budget",
  types: ["conversations", "files", "objects"], // omit for all three
  limit: 30,
  signal: abortController.signal,
});

for (const result of page.results) {
  console.log(result.type, result.title, result.snippet);
  if (result.type === "conversations") {
    console.log(result.agentId, result.conversationId, result.turnId);
  } else {
    console.log(result.path);
  }
}

if (page.nextCursor) {
  const next = await machine.search({
    query: "annual budget",
    types: ["conversations", "files", "objects"],
    cursor: page.nextCursor,
  });
}
```

Search runs under the member's existing access rights. Conversation results
contain decoded user/assistant text and group matching messages into one result.
Files match names, paths, and UTF-8 contents; objects match JSON fields and values.
All query words must occur in the title/path or a single message/document.
Matching is case-insensitive, with title/name matches ranked ahead of body matches.

`limit` defaults to 30 and accepts values from 1 to 100. A busy server returns a
`RoolProblem` with status `429` and code `search_busy`; callers can retry later.

`incomplete: true` means a scan limit or malformed structured document
prevented a complete scan. This version does not extract PDF, Office, or image
content, and excludes hidden paths, symlinks, dependency folders, system messages,
tool activity, and reasoning fields. Search does not call an AI model. A cursor
continues the same query and types against current files; it does not freeze
results while files change.
