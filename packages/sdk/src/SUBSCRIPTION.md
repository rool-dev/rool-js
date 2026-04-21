# `Subscription<TEvent>` — State Machine Spec

This document specifies the behavior of the generic `Subscription<TEvent>` class that replaces `ClientSubscriptionManager` and `SpaceSubscriptionManager` in `subscription.ts`.

Goal: a single class that fully owns the lifecycle of one SSE GraphQL subscription — auth, connect, reconnect with backoff, heartbeat watchdog, online-event handling — with an explicit state machine so race conditions and spurious callbacks are handled by construction.

---

## 1. States

Six states. Each has a defined resource footprint; transitioning in allocates them, transitioning out releases them.

| State | Resources held | Meaning |
|---|---|---|
| `idle` | none | `start()` not yet called, or freshly constructed |
| `awaiting_auth` | none | `authManager.getTokens()` in flight |
| `probing` | `client`, `unsubscribe`, `watchdog`, `lastMessageAt` | GraphQL subscription opened; server-sent `connected` event not yet seen |
| `live` | `client`, `unsubscribe`, `watchdog`, `lastMessageAt` | `connected` event received — session fully established |
| `backoff` | `timer` | waiting to retry after failure |
| `closed` | none | terminal; no further transitions |

**Splitting `probing` / `live`:** the server's `connected` event is how we know the backend acknowledged our subscription (not just that the TCP connection opened). The initial-connect promise (§6) resolves on `probing → live`, and `onConnectionStateChanged('connected')` fires on the same transition. All other transitions treat `probing` and `live` identically.

**Merging "awaiting token" with "creating client":** token resolution and `createClient` happen back-to-back in one function. Splitting them into two states would add no observable behavior because `createClient` is synchronous.

---

## 2. Inputs

Two external (caller-initiated) and six internal (delivered by async sources):

| Input | Source |
|---|---|
| `start()` | caller |
| `stop()` | caller |
| `auth_resolved(tokens)` | `getTokens()` resolved with tokens |
| `auth_failed(err)` | `getTokens()` returned null or threw |
| `message_received(raw)` | graphql-sse `next` callback |
| `watchdog_stale` | heartbeat interval detected staleness |
| `backoff_fired` | retry timer fired |
| `online_event` | `window` `online` event |

**The watchdog is the sole liveness detector.** Every form of death — server close, auth reject, network drop, silent TCP death — manifests as heartbeats no longer arriving, and the watchdog fires `watchdog_stale` within `HEARTBEAT_TIMEOUT`. The state machine has one death input, tied to the currently-owned watchdog interval, which means it cannot be poked by a signal from any other source.

---

## 3. Transition table

Every (state × input) cell has a defined outcome. "Ignore" means no-op. "Impossible" means the input cannot arrive in this state by construction (e.g., `message_received` requires a subscription, which only exists in `probing`/`live`).

| Input ↓ / State → | idle | awaiting_auth | probing / live | backoff | closed |
|---|---|---|---|---|---|
| `start()` | → awaiting_auth, start `getTokens` | ignore | ignore | ignore | ignore |
| `stop()` | → closed | → closed | teardown → closed | cancel timer → closed | ignore |
| `auth_resolved` | impossible | create client+subscription, start watchdog → probing | stale, ignore | stale, ignore | ignore |
| `auth_failed` | impossible | reject init promise if present (§6), → backoff | stale, ignore | stale, ignore | ignore |
| `message_received` | impossible | impossible | update `lastMessageAt`, reset `backoffDelay`; if event is `connected` and state is `probing` → live (resolve init promise §6, emit `'connected'`); deliver event to consumer | stale, ignore | ignore |
| `watchdog_stale` | impossible | impossible | teardown; `backoffDelay = INITIAL` → backoff | impossible (no watchdog in backoff) | impossible |
| `backoff_fired` | impossible | impossible | impossible (no timer) | → awaiting_auth, start `getTokens` | ignore |
| `online_event` | ignore | ignore | ignore | `backoffDelay = INITIAL` (timer left alone) | ignore |

"Stale, ignore" covers the case where a late `message_received` arrives after we've already moved on (e.g., `graphql-sse` delivering a buffered event on a previously-disposed connection). The state check on entry to each handler is sufficient: a stale message lands in the wrong state and is discarded.

---

## 4. Transition discipline (invariants)

These properties must hold after every transition:

1. **State is updated before side effects.** `this.state = next` executes before any `unsubscribe()` call, `clearInterval`, `clearTimeout`, callback invocation, or promise resolution. Re-entrant callbacks observe the new state and no-op via the state check in `handle()`.
2. **Resource ownership matches state.** Entering a state allocates its resources; leaving a state releases them. No resource outlives its state.
3. **Side effects are idempotent.** Teardown calls `unsubscribe()` at most once, `clearInterval` at most once, `clearTimeout` at most once. Reaching `closed` from any state works regardless of what is currently allocated.
4. **Async callbacks never mutate state directly.** They call `handle(input)`, which runs the transition function. No other code path writes `this.state`.
5. **`start()` and `stop()` are idempotent.** Calling `start()` when not in `idle` is a no-op. Calling `stop()` when in `closed` is a no-op. No "subscribe-while-subscribing" race because the guard is on the state enum.

---

## 5. Resource lifecycles

| Resource | Allocated on | Released on |
|---|---|---|
| `client` + `unsubscribe` | entering `probing` (via `auth_resolved`) | leaving `probing`/`live` (any exit) |
| `watchdog` interval | entering `probing`, with `lastMessageAt = Date.now()` | leaving `probing`/`live` |
| `backoff` timer | entering `backoff` | leaving `backoff` (either `backoff_fired` or `stop()`) |
| `online` listener | `start()` (when leaving `idle`) | `stop()` (when entering `closed`) |
| `backoffDelay` (number, not a resource) | persists across transitions; reset on `message_received` and `online_event`; doubled (capped at `MAX`) when entering `backoff` |

**Watchdog starts at subscription creation.** `lastMessageAt` is initialized to `Date.now()` when we enter `probing`. If the server never sends anything — not even a heartbeat — the watchdog fires after `HEARTBEAT_TIMEOUT` and we retry.

---

## 6. Initial-connect promise

`start()` returns a `Promise<void>` that:

- **Resolves** on the first `probing → live` transition (i.e., the server's `connected` event arrives).
- **Rejects** if the first attempt fails before any `connected` event — whether the failure is `auth_failed`, `watchdog_stale`, or `stop()`.
- After resolving or rejecting once, the promise handle is nulled. Subsequent reconnects are silent; consumers learn about them via `onConnectionStateChanged` events.

---

## 7. Connection-state events

The external `onConnectionStateChanged` callback fires on these transitions:

| Transition | Emits |
|---|---|
| `idle` → `awaiting_auth` | `'reconnecting'` |
| `backoff` → `awaiting_auth` | `'reconnecting'` |
| `probing` → `live` | `'connected'` |
| `probing`/`live` → `backoff` | `'disconnected'` then `'reconnecting'` |
| `probing`/`live` → `closed` | `'disconnected'` |
| any other → `closed` | (no emission) |

`'connecting'` and `'reconnecting'` are a single consumer-facing state to keep the API small.

---

## 8. `online` event

The handler resets `backoffDelay` to `INITIAL_RECONNECT_DELAY`. The pending backoff timer is left alone, state is untouched.

The watchdog (§5) is the sole authority on socket liveness and detects stale sockets on its own cadence. `online` exists solely to prevent the backoff value from staying pessimistic across a network outage.

---

## 9. Deliberate omissions

- **Jitter on backoff.** Easy to add later by multiplying the setTimeout delay by `(0.75 + 0.5 * Math.random())`.
- **Pluggable transport.** The class is written against graphql-sse specifically.
- **Server-driven logout handling.** If auth fails mid-session, the state machine goes into backoff and retries indefinitely. The auth manager handles token refresh separately.

---

## 10. Consumer API

```typescript
interface SubscriptionConfig<TEvent> {
  graphqlUrl: string;
  authManager: AuthManager;
  logger: Logger;
  logPrefix: string;               // e.g. '[RoolClient]' or '[RoolChannel] Space abc123'
  query: string;                   // GraphQL subscription query
  variables?: Record<string, unknown>;
  dataField: string;               // top-level field in result.data (e.g. 'clientEvents')
  parseEvent: (raw: Record<string, unknown>) => TEvent | null;
  isConnectedEvent: (event: TEvent) => boolean;
  onEvent: (event: TEvent) => void;
  onConnectionStateChanged: (state: ConnectionState) => void;
  onError: (error: Error) => void;
}

class Subscription<TEvent> {
  constructor(config: SubscriptionConfig<TEvent>);
  start(): Promise<void>;          // see §6
  stop(): void;                    // idempotent
  get isSubscribed(): boolean;     // true iff state is 'live'
}
```

`ClientSubscriptionManager` and `SpaceSubscriptionManager` become thin wrappers that instantiate a `Subscription` with the appropriate query, parser, and data field.
