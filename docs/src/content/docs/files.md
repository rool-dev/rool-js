---
title: Files
---

Every machine exposes the same files to the SDK, agents, and programs running inside the VM. Paths use one of two roots:

- `/rool-drive` is the normal document and file tree. It allows nested folders and arbitrary file contents.
- `/space` holds [structured data](/structured-data/). Its collection, schema, and JSON record layout is enforced, so prefer the structured APIs when working there.

## Read and change files

`machine.files` supports reading, writing, listing, inspecting, moving, copying, and deleting files and directories. `read()` returns a standard `Response`, so the body can be consumed as text, JSON, bytes, or a stream. `write()` accepts fetch-compatible bodies and returns the new file metadata. Set `createParents: true` when writing into new `/rool-drive` folders.

File metadata includes its kind, ETag, dates, content type and size where applicable, and the current access rules. `getStorageUsage()` returns the used and available bytes.

ETags prevent accidental overwrites when more than one user or agent can edit a file:

```typescript
const current = await machine.files.stat("/rool-drive/plan.md");
await machine.files.write("/rool-drive/plan.md", nextPlan, {
  contentType: "text/markdown",
  ifMatch: current.etag,
});
```

The write fails if the file changed after `stat()`. `ifNoneMatch: "*"` provides the corresponding create-only write. Reads also support byte ranges and cache preconditions. For batches, `readMultiple()` and `deleteMultiple()` keep a separate result for each path.

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
