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
- `getPlans()` returns the plans and top-ups: what each plan gives (refill, machines and their hardware, storage, features), its monthly price and App Store product when it is for sale, and each top-up's credits and price. A plan's `upgrades` are the plans to offer its subscribers; stepping down goes through the store's subscription management. Match an account's `plan` to a plan's `id`, and show the server's `name`. Use the catalog instead of hardcoding plan numbers or prices: they change without an app release. The catalog is public and the same for everyone. Prices on iOS come from the App Store; the catalog names the products.
- `deleteUser()` starts deletion of the user, together with the accounts no one else is a member of.

These methods return snapshots. Use [live updates](/live-updates/) to learn when a snapshot is stale, then fetch the latest value.

The client also contains top-level helpers for greetings, Speechmatics tokens, invites, and vouchers. Machine-specific work starts with `client.machine(machineId)`.

## Teams

A team is an account people share. `createTeam(name)` starts one on the Team plan, with the user as its only admin. A team has no balance of its own to start with and pays for what its members do on its machines.

`client.account(accountId)` is a handle on an account the user is on the roster of:

- `members.list()` returns the roster. `members.setRole(userId, role)` makes someone an `admin` or a `member` and returns the role the server recorded; an account always keeps one admin (`last_account_admin`). `members.remove(userId)` takes someone off the roster, and off every machine of the account. A member leaves by removing themselves. Machines they own there need another owner first (`member_owns_machines`), and no one leaves their home account (`home_account`).
- `invites.create({ role, email })` mints an invite link, emailed when `email` is set. Only teams take invites. `getTeamInvitePreview(token)` and `redeemTeamInvite(token)` show and accept one.
- `rename(name)` renames the team, and `listMachines()` returns every machine it pays for, including those the admin is not a member of. Both are for admins.
- `delete()` deletes the team, for its admins, once it pays for no machines (`account_has_machines`). Its roster, invites and spending history go with it, and any balance it has left is forfeit, so confirm that with the user first. A home account goes only with its user (`home_account`).

Members only see the team's machines they are on. Every roster change sends `account_changed` to the members.

Who pays depends on the person as well as the machine. A machine summary's `payingAccountId` is the account that pays for the user's work on it: the machine's account (`accountId`) when they are on its roster, their home account otherwise. Show the balance of that account, and its name when it is a team.
