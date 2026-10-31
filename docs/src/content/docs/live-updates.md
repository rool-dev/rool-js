---
title: Live updates
---

Live updates tell a client that something changed. They are not a second copy of the data: fetch the latest value after receiving an event.

## User events

`client.events.subscribe()` starts the event loop. Its first event is a `session` containing the current user, accounts, profile, app data, machines, and server information. Later events identify the part that may now be stale:

| Event                     | What to refresh                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `account_changed`         | `client.getAccount(event.accountId)`                                                                       |
| `profile_changed`         | `client.getProfile()` and `client.getUser()`                                                               |
| `email_access_changed`    | `client.emailAccess.list()`                                                                               |
| `user_app_data_changed`   | `client.getUserAppData()`                                                                                  |
| `providers_changed`       | `account(event.accountId).getProviders()`, and `machine.getModels()` for each open machine of that account |
| `machines_changed`        | `client.listMachines()` or the named machine                                                               |
| `machine_members_changed` | `machine.members.list()`                                                                                   |
| `mcp_connections_changed` | `machine.mcpConnections.list()`                                                                            |
| `webdav_credentials_changed` | `machine.webdavCredentials.list()`                                                                      |
| `conversation_changed`    | the named conversation                                                                                     |

An `account_changed` for an account the user has left, or that was deleted, makes `getAccount()` fail with `account_not_found`: drop that account.

Treat a new `session` event as a full reset of user and account state. It can also arrive later if Rool can no longer continue from the previous event.

Events may combine several quick changes, so do not use them as an audit log or count on one event per write. The loop retries temporary failures automatically. `client.events.error` exposes its current error, and polling stops after the last subscriber unsubscribes.

```typescript
const unsubscribe = client.events.subscribe((event) => {
  if (event.type === "machines_changed") refreshMachines();
});

// Later
unsubscribe();
```

## Higher-level watchers

`client.emailAccess.watch()` keeps the user's [extra email addresses](/client-and-account/#email-access) current, including confirmation state. It fetches them separately from the session and refreshes them on `email_access_changed` and session resets.

User events do not carry file changes. `machine.files.watch()` maintains a file metadata tree from changes made by any client, agent, or program in the VM.

`machine.webdavCredentials.watch()` keeps [WebDAV credential metadata](/files/#connect-an-external-webdav-client) current, without passwords. `machine.mcpConnections.watch()` maintains the connection collection, including OAuth authorization state. `conversation.watch()` refreshes saved turns and follows the current run for live output. Use the lower-level event subscription only when maintaining your own state model.
