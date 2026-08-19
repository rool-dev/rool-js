---
title: Live updates
---

Live updates tell a client that something changed. They are not a second copy of the data: fetch the latest value after receiving an event.

## Account events

`client.events.subscribe()` starts the account event loop. Its first event is a `session` containing current account, profile, app data, machines, and server information. Later events identify the part that may now be stale:

| Event                     | What to refresh                              |
| ------------------------- | -------------------------------------------- |
| `account_changed`         | `client.getAccount()`                        |
| `profile_changed`         | `client.getProfile()`                        |
| `user_app_data_changed`   | `client.getUserAppData()`                    |
| `machines_changed`        | `client.listMachines()` or the named machine |
| `machine_members_changed` | `machine.members.list()`                     |
| `conversation_changed`    | the named conversation                       |

Treat a new `session` event as a full reset of account state. It can also arrive later if Rool can no longer continue from the previous event.

Events may combine several quick changes, so do not use them as an audit log or count on one event per write. The loop retries temporary failures automatically. `client.events.error` exposes its current error, and polling stops after the last subscriber unsubscribes.

```typescript
const unsubscribe = client.events.subscribe((event) => {
  if (event.type === "machines_changed") refreshMachines();
});

// Later
unsubscribe();
```

## Files and conversations

Account events do not carry file changes. `machine.files.watch()` maintains a file metadata tree from changes made by any client, agent, or program in the VM.

For conversations, `conversation.watch()` is the higher-level option. It uses account events to refresh saved turns and follows the current run for live output. Use the lower-level account subscription only when maintaining your own state model.
