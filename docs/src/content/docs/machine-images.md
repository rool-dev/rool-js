---
title: Machine images
---

A machine image decides the system a machine runs: its installed software and system files, not its data. It is a recipe of shell steps run as root over the stock Rool system, with files put over the result, kept as numbered revisions. Machine images belong to an account, and a machine follows the default revision of the one it runs.

Revisions are made on a machine. In edit mode it records steps and files, run by its agent or in its shell with `rool-machine-image`, and a save turns them into a revision. The SDK starts and saves an edit, lists and administers machine images, moves machines between them, and works with the Rool Hub.

## An account's machine images

```ts
const account = client.account(accountId);

// account.machineImages.watch(({ machineImages }) => ...) keeps a list current.
for (const image of await account.machineImages.list()) {
  console.log(image.name, image.defaultRevision, image.revisions[0].stepCount);
}

const image = client.machineImage(machineImageId);
console.log((await image.get()).description);
const revision = await image.getRevision(2);
console.log(revision.recipe, revision.files);

await image.update({ description: "R and the tidyverse." });
await image.setDefaultRevision(2);
await image.delete();
```

A revision lists its files with their sizes. To show what is in them, open its archive:

```ts
const files = await image.files(2);
console.log(files.paths); // ["/etc/hosts", "/etc/rool/theme.json"]
console.log(await files.text("/etc/hosts"));
const picture = await files.read("/etc/rool/icon.webp"); // bytes
```

`files()` downloads a revision's files as the one compressed archive they are stored in, at most 16 MiB, and keeps it compressed. A file is unpacked when you read it, so keep the result while showing files, and read only what you show. A browser keeps the download and asks the server each time whether it still holds, so opening the same files again costs one small request. A revision without files gives no paths. `client.hub.machineImages.files(id)` does the same for a listed machine image.

`setDefaultRevision()` restarts every machine whose system it changes and reports how many. Rolling back is setting an older revision. `delete()` is refused with `machine_image_in_use` while machines run the machine image.

## The machine image a machine runs

```ts
const machine = client.machine(machineId);

await machine.machineImage.use(machineImageId); // null for the stock system
const state = await machine.machineImage.get();
console.log(state.machineImage?.name, state.machineImage?.revision, state.changing, state.error);
```

Every machine in `client.listMachines()` and `account.listMachines()` carries `machineImage`, with the id, name and revision it runs, so an overview needs no call per machine. It is null on the stock system.

`use()` resolves once the change is asked for; the machine restarts when the revision is built. `watch()` reports the state now and each time it changes:

```ts
const stop = machine.machineImage.watch(({ state }) => {
  if (!state) return; // not loaded yet
  if (state.changing) console.log("building");
  else if (state.error) console.error(state.error);
  else console.log("running", state.machineImage?.name ?? "the stock system");
});
// later
stop();
```

A new machine can start on a machine image with `createMachine({ name, machineImageId })`.

### Edit and save

```ts
const { editRefusal } = await machine.machineImage.get();
if (editRefusal === null) await machine.machineImage.startEditing();

// The agent or a shell records steps and files. Then one of:
await machine.machineImage.save(); // the machine image's next revision
// or
await machine.machineImage.saveAs({ name: "Data", description: "R and the tidyverse." }); // a new machine image
```

`startEditing()` restarts the machine into edit mode and `discardEdits()` leaves it without saving. `editRefusal` says why the caller cannot start: `permission`, `plan` when the plan that pays for the machine does not include editing, or `other_members`, since only a machine with no other members can be edited. Treat a value you do not know as a refusal: the server may add reasons. Ask `editRefusal` rather than the `machine.image.edit` action of `client.acl`, which covers the permission alone. A machine on the stock system has no machine image to add to, so its first save is `saveAs()`.

`save()` and `saveAs()` resolve once the save is asked for. The machine restarts on the new revision when it is built; if the build fails it stays in edit mode and `error` says why. The new revision runs on this machine only, until `setDefaultRevision()` moves the others.

### The default theme and icon

A machine image can carry a theme and an icon, as files under `/etc/rool`: `theme.json`, and `icon.webp`, `icon.png` or `icon.jpg`. A save from a machine with a theme or icon of its own puts them there. A revision's `theme` and `icon` hold what its files carry, and a machine's summary gives those of the revision it runs under `machineImage`. The machine's own win:

```ts
for (const summary of await client.listMachines()) {
  const theme = summary.theme ?? summary.machineImage?.theme;
  const icon = summary.icon ?? summary.machineImage?.icon;
}
```

`machine.settings.setTheme(null)` and `setIcon(null)` return a machine to its machine image's.

## The Rool Hub

The Hub lists machine images that accounts have published. Taking one makes a copy in your account, which is yours from then on: nothing changes it but your account.

```ts
const listed = await client.hub.machineImages.list();
const detail = await client.hub.machineImages.get(listed[0].id);
console.log(detail.recipe, detail.files);

const copy = await account.machineImages.copyFromHub(detail.id);
await machine.machineImage.use(copy.id);
```

When the machine image a copy was made from publishes a newer revision, the copy's `copiedFromPublishedRevision` is higher than the `copiedFromRevision` of its revisions. `updateCopy()` adds that revision to the copy. The default revision stays, so machines move when you set it:

```ts
const { revision } = await client.machineImage(copy.id).updateCopy();
await client.machineImage(copy.id).setDefaultRevision(revision);
```

Changes made to the copy itself are not merged into the new revision.

### Publish to the Hub

```ts
const image = client.machineImage(machineImageId);
await image.submit(); // the default revision, or submit(3)
```

Rool reviews each submitted revision. Each revision in `account.machineImages.list()` carries its `review`: `pending`, `approved`, or `rejected` with a note saying why. An approved revision is listed under the name and description the machine image had when it was submitted, and anyone can read its recipe and files, so keep secrets out of a revision you submit.

One submission waits at a time. `unlist()` takes the machine image off the Hub and withdraws a waiting submission; copies already made stay.
