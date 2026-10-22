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
- `account(id).getProviders()` returns the third parties that receive content from the account's machines, with server-written disclosure copy: `always` for the processors of record and `optional` for the ones the account can turn off, each with `enabled`. The policy is the account's: on a machine it applies to everyone working there, whoever pays, so a guest on a team machine gets the team's policy. Members read it; `account(id).setProviderEnabled(id, enabled)` is for admins (`provider_not_found` for an id that is not switchable). The server enforces it inside conversations: a tool call that needs a disabled provider fails with a message naming it, and a generation only that provider could serve settles as an error turn. The client-level `getProviders()` and `setProviderEnabled()` are deprecated and act on the home account.
- `machine(id).getModels()` returns the models a prompt on that machine can use, each with its effort levels, plus the `default` model and each model's `defaultEffort`: the plan of the account paying for the caller there (the machine's when they are on its roster, their home account otherwise) through the machine's account's provider policy. Ids and copy come from the server, so never hardcode them. Show a model selector only when there are two or more models, and an effort control only when the chosen model has two or more efforts. An effort's `cost` is relative credit use (`low`, `medium`, `high`); new values can appear without an SDK release, so treat one you don't recognize as `medium`, and an unknown `icon` as a generic icon. Fetch it when the machine opens, on `providers_changed`, and again when the user opens a selector. The client-level `getModels()` is deprecated and applies the home account's policy.
- `getPlans()` returns the plans, what each gives (refill, machines and their hardware, storage, features), and their prices for the caller. The server picks the caller's `market` from their platform, country and any Stripe subscription they have: `stripe` sells on the web in its `currency`, `apple` through the App Store. A plan's `subscription` and each top-up carry the web `price` or the `appleProductId`, whose localized price comes from StoreKit; `subscription` is null for a plan not sold in that market, such as a free one. Prices are there even where the caller may not buy: `market.forSale` says whether they can, so show the price and replace the buy button with "not available in your country" where it is false. A plan's `upgrades` are the plans to offer its subscribers; stepping down goes through the store's subscription management. Match an account's `plan` to a plan's `id`, and show the server's `name`. Leave `none` out of any plan picker: it is the absence of a plan, listed only so its `upgrades` can say what to offer. Use the catalog instead of hardcoding plan numbers, prices or product ids: they change without an app release. The catalog is public, so a website can show the same prices without signing in. Its `usage` lists what calls cost, in dollars for everyone: every model priced per million input, cached and output tokens, then images, searches, page reads and speech priced per `unit`. `usdPerCredit` turns any of them into credits.
- `deleteUser()` starts deletion of the user, together with the accounts no one else is a member of.

These methods return snapshots. Use [live updates](/live-updates/) to learn when a snapshot is stale, then fetch the latest value.

The client also contains top-level helpers for greetings, Speechmatics tokens, invites, and vouchers. Machine-specific work starts with `client.machine(machineId)`.

## Teams

A team is an account people share. `createTeam(name)` starts one on the Team plan, with the user as its only admin. A team has no balance of its own to start with and pays for what its members do on its machines.

`client.account(accountId)` is a handle on an account the user is on the roster of:

- `members.list()` returns the roster. `members.setRole(userId, role)` makes someone an `admin` or a `member` and returns the role the server recorded; an account always keeps one admin (`last_account_admin`). `members.remove(userId)` takes someone off the roster, and off every machine of the account. A member leaves by removing themselves. Machines they own there need another owner first (`member_owns_machines`), and no one leaves their home account (`home_account`).
- `members.setDailyLimit(userId, usd)` caps what a member, the admin included, spends on the team in any 24 hours; null lifts it (`invalid_member_limit` for anything but dollars from 0 up or null, `member_not_found` on a home account or for someone not on the roster). Each member's `spentUsd` on the roster is their charges in the last 24 hours, kept cap or no cap, and the user's own `RoolAccount` carries both figures. Spend at the cap fails as out of money until charges age out of the window.
- `invites.create({ role, email, machines })` mints an invite link, emailed when `email` is set. Only teams take invites. `machines` names machines of the team, each with a machine role, that the taker lands on when they accept and has no access to before; `invites.setMachine(inviteId, machineId, role)` and `invites.removeMachine(inviteId, machineId)` change that list on an open invite (`account_invite_not_found` once it is used, revoked or expired; `machine_not_on_account` for a machine the team does not pay for). This is how a new teammate is put on their machines: one email, no machine invites. A link invite may carry machines too, as an onboarding link. `getTeamInvitePreview(token)` and `redeemTeamInvite(token)` show and accept one.
- `rename(name)` renames the team, and `listMachines()` returns every machine it pays for, including those the admin is not a member of. Both are for admins.
- `delete()` deletes the team, for its admins, once it pays for no machines (`account_has_machines`). Its roster, invites and spending history go with it, and any balance it has left is forfeit, so confirm that with the user first. A home account goes only with its user (`home_account`).

Members only see the team's machines they are on. Every roster change sends `account_changed` to the members.

Someone who signs up to accept a team invite gets no personal plan: their home account's `plan` is `none`, with no credits, refill or machines, so an app shows nothing of Rool.app for it. `account(homeId).startPersonalPlan()` gives them Standard with its start credits, once (`personal_plan_exists` after that, `not_home_account` on any other account). They may also subscribe to Plus or Pro directly; the catalog lists those as the `none` plan's `upgrades`. A user who had an account before the invite keeps their plan. `refilledAt` stays set on such an account, at its creation, as it does on a team.

A team's balance is in dollars, and its admins buy it by card: `topUp(amountUsd)` returns a Stripe Checkout URL for whole dollars from 10 to 1000, tax on top, and paying saves the card. `setAutoRecharge({ thresholdUsd, amountUsd })` then charges that card for the amount whenever the balance falls below the threshold, which is whole dollars up to 10000, the amount in the top-up range; it fails with `no_saved_card` before the first top-up, and `stopAutoRecharge()` turns it off. An amount out of range fails with `invalid_top_up_amount`, and a home account with `not_a_team`. If a recharge fails, auto-recharge turns itself off and the admins get an email. The account's `autoRecharge` and `savedCard` show the state.

A team's machines pay rent from its balance, by the second, at their type's monthly price in `getPlans().machineTypes`. A team machine has a type of its own: `createMachine({ name, accountId, type })` sets it, and `machine.setType(type)` changes it, from the next boot. Both are for the team's admins (`account_admin_required`), as is copying a machine onto the team. A type that is not in the catalog or not `available`, or a type on a machine outside a team, fails with `invalid_machine_type`. A machine summary's `machineType` is the hardware it boots with. A team adds a machine, or a dearer type, only while its balance covers a month of rent for all its machines; otherwise the request fails with `insufficient_balance`, whose detail says how much to top up. AI stops when the balance reaches zero. Rent may take it below zero by up to a week of the team's rent, and its machines keep running meanwhile; past that they do not start, and requests that need one fail with `team_out_of_money`, until a top-up pays the debt. The account's `shutAt` says when that happened, and is null while its machines may run.

Who pays depends on the person as well as the machine. A machine summary's `payingAccountId` is the account that pays for the user's work on it: the machine's account (`accountId`) when they are on its roster, their home account otherwise. Show the balance of that account, and its name when it is a team.
