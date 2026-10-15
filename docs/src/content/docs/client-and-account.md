---
title: Client and account
---

`RoolClient` is the entry point for user, account and machine operations. It adds authentication to each request, but it does not cache any of it.

## Authentication

Authentication is separate from the client, so choose the helper that fits the app:

- `NodeAuth` opens a browser and keeps credentials it can refresh in a local file. Import it from `@rool-dev/sdk/node`.
- `BrowserAuth` redirects to Rool and processes the return URL in `initialize()`. It keeps credentials in browser storage.
- `NativeAuth` opens sign-in with a supplied `openExternal` function. Pass deep-link returns to `handleRedirect()`; password and magic-link flows are also available.

Call `initialize()` before making protected requests. Pass the auth helper's `getTokens` to `RoolClient`, and normally pass `logout` as `onAuthInvalidated`. The client asks for tokens before every request, which lets the helper refresh them when needed. Apps with their own authentication can instead provide `getTokens` or `getAccessToken` directly.

The optional `client` configuration identifies your app and version in requests. `apiUrl` and `fetch` are mainly useful for custom environments and tests.

## Users and accounts

The signed-in person is a user. What pays, and on which plan, is an account. Every user has a home account, created when they signed up, and may be a member of other accounts. An account's balance is in US dollars (`balanceUsd`) and in credits (`balanceCredits`), the unit Rool.app shows.

## Load user and account state

Use `getSession()` for an initial load. It returns the user, their accounts (home account first), profile, app data, machine list, and server compatibility in one response. The narrower methods are useful when refreshing one part later:

- `getUser()` returns who the user is: id, email, photo, and their total credit use.
- `getAccounts()` returns the accounts the user is a member of, each with its plan, balance, subscription, and the user's role. `getAccount(accountId)` returns one of them, or fails with `account_not_found`.
- `getProfile()` and `replaceProfile()` read or replace the editable name and marketing preference.
- `getUserAppData()` returns per-account JSON values for app state. `setUserAppData()` and `deleteUserAppData()` change one top-level key.
- `getProviders()` returns the third parties that receive user content, with server-written disclosure copy: `always` for the processors of record and `optional` for the ones the user can turn off, each with `enabled`. Providers are not part of the session, so call this separately. `setProviderEnabled(id, enabled)` records the choice (`provider_not_found` for an id that is not switchable). The server enforces it inside conversations: a tool call that needs a disabled provider fails with a message naming it, and a generation only that provider could serve settles as an error turn.
- `getModels()` returns the models a prompt can use, each with its effort levels, plus the `default` model and each model's `defaultEffort`. Ids and copy come from the server, so never hardcode them. Show a model selector only when there are two or more models, and an effort control only when the chosen model has two or more efforts. An effort's `cost` is relative credit use (`low`, `medium`, `high`); new values can appear without an SDK release, so treat one you don't recognize as `medium`, and an unknown `icon` as a generic icon. The catalog has no live update, so fetch it when your app starts and again when the user opens a selector. Treat it as specific to the signed-in account.
- `deleteUser()` starts deletion of the user, together with the accounts no one else is a member of.

These methods return snapshots. Use [live updates](/live-updates/) to learn when a snapshot is stale, then fetch the latest value.

The client also contains top-level helpers for greetings, Speechmatics tokens, invites, and vouchers. Machine-specific work starts with `client.machine(machineId)`.
