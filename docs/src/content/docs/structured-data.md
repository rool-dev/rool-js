---
title: Structured data
---

Structured data gives an app predictable records without hiding them from the machine. Each record is also a normal JSON file, so agents and programs can read or edit the same data with file tools.

The layout is fixed:

```text
/space/.meta.json
/space/tasks/.schema.json
/space/tasks/launch.json
```

A collection owns one schema and its records. Record paths have the form `/space/<collection>/<name>.json`; the JSON body contains only the record's fields.

## Collections and objects

Create the collection before writing records:

```typescript
await machine.collections.create("tasks", {
  fields: [
    { name: "title", type: { kind: "string" } },
    { name: "done", type: { kind: "boolean" } },
  ],
});

await machine.objects.create("/space/tasks/launch.json", {
  title: "Launch the app",
  done: false,
});
```

The schema is enforced for writes made through the SDK and inside the VM. Undeclared fields, missing required fields, and values of the wrong type are rejected. Besides strings, numbers, and booleans, fields can be arrays, enums, fixed literals, or references to other record paths. Wrap a type in `maybe` when the field may be absent or null.

Collections can be listed, read, replaced, and removed. Objects can be read individually or in batches, and created, replaced, patched, moved, or removed. These operations use file ETags so a concurrent edit is not silently overwritten.

`machine.objects.list()` is a synchronous view of the watched file tree. Start `machine.files.watch()` before using it to discover existing records:

```typescript
await machine.files.watch();
const taskPaths = machine.objects.list({ collection: "tasks" });
```

Use `get()` or `getMultiple()` to load the record bodies.

## Machine metadata

`machine.metadata` stores small machine-wide JSON values in `/space/.meta.json`. It is useful for shared app settings such as a selected layout or project configuration. This differs from client user app data, which belongs to one account rather than one machine.
