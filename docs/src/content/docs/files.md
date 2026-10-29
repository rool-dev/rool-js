---
title: Files
---

Every machine exposes the same files to the SDK, agents, and programs running inside the VM. Paths use one of two roots:

- `/rool-drive` is the normal document and file tree. It allows nested folders and arbitrary file contents.
- `/space` holds [structured data](/structured-data/). Its collection, schema, and JSON record layout is enforced, so prefer the structured APIs when working there.

## Read and change files

`machine.files` supports reading, writing, listing, inspecting, moving, copying, and deleting files and directories. `read()` returns a standard `Response`, so the body can be consumed as text, JSON, bytes, or a stream. `write()` accepts fetch-compatible bodies and returns the new file metadata. Set `createParents: true` when writing into new `/rool-drive` folders.

File metadata includes its kind, ETag, dates, content type and size where applicable, and the current access rules. For disk usage against the plan, use [`machine.getStorage()`](/machines-and-sharing/).

ETags prevent accidental overwrites when more than one user or agent can edit a file:

```typescript
const current = await machine.files.stat("/rool-drive/plan.md");
await machine.files.write("/rool-drive/plan.md", nextPlan, {
  contentType: "text/markdown",
  ifMatch: current.etag,
});
```

The write fails if the file changed after `stat()`. `ifNoneMatch: "*"` provides the corresponding create-only write. Reads also support byte ranges and cache preconditions. For batches, `readMultiple()` and `deleteMultiple()` keep a separate result for each path.

## Connect an external WebDAV client

Use `machine.webdavCredentials` to connect a file manager or another WebDAV app to the machine's hostname URL. This endpoint exposes `/rool-drive` at `/`, not `/space`.

```typescript
const credential = await machine.webdavCredentials.create({ name: "My laptop" });
// Configure the WebDAV app with credential.url,
// credential.username, and credential.password (HTTP Basic authentication).
```

The password is returned only by `create()` and cannot be retrieved later. Keep it out of logs. `list()` returns active credential metadata without passwords; `revoke(credential.id)` disconnects that credential.

These credentials do not authenticate SDK or API requests. `machine.files` uses your existing sign-in through `/v2/machines/:id/dav`, where both `/rool-drive` and `/space` are available.

Creating or using a credential requires owner, admin, or editor access. Credentials belong to the member who creates them. Owners and admins can list and revoke everyone's credentials; other members can only list and revoke their own.

For a settings screen, watch the list instead of polling:

```typescript
const stopWatching = machine.webdavCredentials.watch((view) => {
  renderCredentials(view.credentials, view.loading, view.error);
});

// When the screen closes
stopWatching();
```

## Keep a file tree current

Call `watch()` once to populate `files.tree` and keep its metadata current:

```typescript
await machine.files.watch();

const unsubscribe = machine.files.tree.subscribe(({ changed, deleted }) => {
  updateFileBrowser(changed, deleted);
});
```

The tree contains metadata, not file bodies. Use `tree.get()` or `tree.list()` for fast synchronous views, then `read()` when content is needed. Changes made through the SDK, by an agent, or inside the VM all arrive through the same watch.

The watch retries temporary failures in the background; `watchError` exposes the current failure. Call `unwatch()` when the machine is no longer active. See [live updates](/live-updates/) for how file watches differ from account events.
