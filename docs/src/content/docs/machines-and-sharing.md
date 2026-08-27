---
title: Machines and sharing
---

A machine handle groups everything that belongs to one persistent VM: settings, files, agents, structured data, checkpoints, and sharing.

```typescript
const created = await client.createMachine({ name: "Research" });
const machine = client.machine(created.id);
```

`client.machine()` only creates or reuses a local handle; it does not check the server. Call `machine.get()` when you need the latest summary. Use `listMachines()` to refresh the machines visible to the current account.

## Lifecycle

Machine settings currently contain the name and are replaced as a whole. A machine also has a globally unique hostname used for a variety of public facing features. Set it with `machine.setHostname("research-notes")`. Hostnames contain 1 to 30 lowercase letters, numbers, or hyphens, cannot start or end with a hyphen, and cannot use a reserved name. Machine summaries include the resulting external WebDAV endpoint as `webDavUrl`.

`duplicate()` copies the machine's current files and conversations into an independent machine owned only by the person making the copy. Sharing does not carry over.

Rool creates filesystem checkpoints automatically. `machine.checkpoints.list()` returns the restorable points and `restore()` moves the whole machine back to one of them. A watched file tree resets itself after a restore. Deleting a machine requires its owner and stops any file watch held by that handle.

`machine.fetchUrl()` fetches a public HTTP or HTTPS URL through Rool and returns a normal `Response`. Non-success HTTP responses are returned rather than thrown, while private network destinations are blocked.

## Members and invites

The four machine roles are deliberately simple:

- **owner** — full control, including deletion
- **admin** — can edit the machine and manage its members and invites
- **editor** — can change files and run agents
- **viewer** — can read shared machine data

Owners and admins create either a shareable link or an email invite with `machine.invites.create()`. An invite chooses the new member's role and can limit its lifetime or number of uses. Keep the returned `url`; listed invites intentionally do not reveal it again.

An app can preview an invite before sign-in with `client.getInvitePreview(token)`. After sign-in, `client.redeemInvite(token)` adds or updates the member. Admins can list and revoke invites, change member roles, and remove members. Any non-owner member can also remove themselves; ownership cannot be assigned through the role API.
