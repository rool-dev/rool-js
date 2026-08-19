---
title: Client and account
---

`RoolClient` is the entry point for account and machine operations. It adds authentication to each request, but it does not cache account data.

## Authentication

Authentication is separate from the client, so choose the helper that fits the app:

- `NodeAuth` opens a browser and keeps credentials it can refresh in a local file. Import it from `@rool-dev/sdk/node`.
- `BrowserAuth` redirects to Rool and processes the return URL in `initialize()`. It keeps credentials in browser storage.
- `NativeAuth` opens sign-in with a supplied `openExternal` function. Pass deep-link returns to `handleRedirect()`; password and magic-link flows are also available.

Call `initialize()` before making protected requests. Pass the auth helper's `getTokens` to `RoolClient`, and normally pass `logout` as `onAuthInvalidated`. The client asks for tokens before every request, which lets the helper refresh them when needed. Apps with their own authentication can instead provide `getTokens` or `getAccessToken` directly.

The optional `client` configuration identifies your app and version in requests. `apiUrl` and `fetch` are mainly useful for custom environments and tests.

## Load account state

Use `getSession()` for an initial load. It returns the account, profile, app data, machine list, and server compatibility in one response. The narrower methods are useful when refreshing one part later:

- `getAccount()` returns identity, plan, credit, and usage information.
- `getProfile()` and `replaceProfile()` read or replace the editable name and marketing preference.
- `getUserAppData()` returns per-account JSON values for app state. `setUserAppData()` and `deleteUserAppData()` change one top-level key.
- `deleteAccount()` starts account deletion.

These methods return snapshots. Use [live updates](/live-updates/) to learn when a snapshot is stale, then fetch the latest value.

The client also contains top-level helpers for greetings, Speechmatics tokens, invites, and gifts. Machine-specific work starts with `client.machine(machineId)`.
