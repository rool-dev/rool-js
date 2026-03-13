# Rool Apps — Architecture

## What an app is

A small Svelte client-side application that communicates with a Rool channel through a message-passing bridge. No auth, no space selection, no direct SDK access. The bridge is its entire world.

## Security model

Apps run inside a **sandboxed iframe**. This provides a hard security boundary:

- No access to the host's DOM, JavaScript, cookies, or localStorage
- No access to auth tokens or the underlying `RoolClient`
- All channel operations go through a `postMessage` bridge controlled by the host
- The channel enforces permissions (SDK + server) — the host doesn't need to validate

This means a malicious app cannot escalate beyond the permissions of its channel.

**Dev vs production sandbox:**
- **Dev:** `sandbox="allow-scripts allow-same-origin"` (same Vite dev server, needed for HMR)
- **Production:** `sandbox="allow-scripts"` (cross-origin iframe, full isolation)

## Host contract

The host (console or dev shell) provides:

- A **sandboxed iframe** pointed at the app's origin
- A **postMessage bridge** that proxies channel operations
- Real-time **event forwarding** (objectCreated, objectUpdated, etc.)
- **Channel setup** — sets the channel name and system instruction from the manifest

The app provides everything else for itself — Svelte, styling, dependencies.

## App source contract

An app is exactly two files:

```
my-app/
├── App.svelte        # Root component (required, fixed name)
└── rool-app.json     # Manifest (required)
```

The root component is always `App.svelte`. It can import other `.svelte`, `.svelte.ts`, and `.ts` files — standard Svelte/JS module resolution applies. There is no `index.html`, no `main.ts`, no `vite.config.js`. The build system synthesizes these internally.

`App.svelte` receives a `channel` prop (a `ReactiveAppChannel`) from the synthesized bootstrap. Tailwind is available automatically — no CSS import needed (though an optional `app.css` is supported for custom styles).

## App bundle

A build produces:

- `index.html` — synthesized entry point loaded by the iframe
- `app.js` — application code, with all dependencies bundled (including Svelte)
- `rool-app.json` — manifest

Since the app runs in an isolated iframe, it bundles its own copy of Svelte, Tailwind, and any other dependencies. There are no shared externals with the host.

## App manifest

Each app has a `rool-app.json` at its root. `id` and `name` are required:

```json
{
  "id": "dummy-chat",
  "name": "Dummy Chat",
  "description": "What it does.",
  "capabilities": {
    "create": true,
    "update": true,
    "delete": false,
    "prompt": true,
    "schema": false
  },
  "systemInstruction": "Be as funny as you can while still being helpful"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Used as the channel ID when the host opens a channel for the app |
| `name` | Yes | Display name shown in the dev host sidebar and used as the channel name |
| `description` | No | Shown in the dev host sidebar |
| `capabilities` | No | Declares what the app can do (future: enforced by the bridge) |
| `systemInstruction` | No | Set on the channel to customize AI behavior |

The dev host validates the manifest at startup and watches for changes during development. Invalid manifests are reported in the sidebar and terminal — the dev server keeps running.

## Bridge protocol

Communication between host and app uses `window.postMessage`. The app imports `@rool-dev/app` which provides a reactive Svelte channel API over this protocol.

### App → Host (requests)

```typescript
{
  type: 'rool:request',
  id: string,          // unique request ID for response correlation
  method: string,      // channel method name (e.g. 'prompt', 'createObject', 'getObject')
  args: unknown[]      // method arguments
}
```

### Host → App (responses)

```typescript
{
  type: 'rool:response',
  id: string,          // matches request ID
  result?: unknown,    // return value on success
  error?: string       // error message on failure
}
```

### Host → App (events)

```typescript
{
  type: 'rool:event',
  name: string,        // event name (e.g. 'objectCreated', 'objectUpdated', 'objectDeleted')
  data: unknown        // event payload
}
```

### Handshake

When the iframe loads, the app sends a `rool:ready` message. The host responds with `rool:init` containing channel metadata (channelId, role, schema, etc.). The bridge client waits for this before resolving its initialization promise.

## Host side (`createBridgeHost`)

The host side of the bridge (`@rool-dev/app/host`):

1. Opens a channel using the manifest's `id` as channelId
2. Renames the channel to the manifest's `name` (if different)
3. Sets the system instruction from the manifest (if different from current)
4. Renders a sandboxed iframe
5. Listens for `rool:ready`, sends `rool:init`
6. Proxies `rool:request` messages to the real `RoolChannel`
7. Forwards channel events as `rool:event` messages

The `BridgeableChannel` interface accepts both `RoolChannel` and `ReactiveChannel`, so the host can use either the SDK or Svelte wrapper.

## @rool-dev/app (app side)

A Svelte-first package that apps import. The public API is reactive:

- `initApp(): Promise<ReactiveAppChannel>` — waits for the bridge handshake, returns a reactive channel
- `ReactiveAppChannel` — mirrors the `@rool-dev/svelte` `ReactiveChannel` API with `$state` properties
- Reactive properties: `interactions`, `objectIds` (auto-update from bridge events)
- Methods: `prompt()`, `createObject()`, `updateObject()`, `deleteObjects()`, `findObjects()`, `getObject()`, etc.
- Reactive primitives: `object(id)`, `watch({ where })` — same API as `@rool-dev/svelte`

```svelte
<!-- App.svelte -->
<script lang="ts">
  import type { ReactiveAppChannel } from '@rool-dev/app';

  interface Props { channel: ReactiveAppChannel; }
  let { channel }: Props = $props();

  // Reactive — updates automatically
  // channel.interactions
  // channel.objectIds
</script>

{#each channel.interactions as interaction}
  <div>{interaction.output}</div>
{/each}
```

The app receives `channel` as a prop from the synthesized bootstrap — it does not call `initApp()` directly. The raw `AppChannel` (async postMessage bridge) is internal — not part of the public API.

## Package structure

```
packages/app/
├── src/
│   ├── index.ts              # Public exports: initApp, ReactiveAppChannel, types
│   ├── client.ts             # Internal: AppChannel (postMessage bridge transport)
│   ├── host.ts               # BridgeHost: createBridgeHost() for host side
│   ├── protocol.ts           # Bridge message types and type guards
│   ├── types.ts              # Lightweight SDK type mirrors (no runtime SDK dependency)
│   ├── reactive.svelte.ts    # ReactiveAppChannel wrapping AppChannel
│   ├── cli/
│   │   └── dev.ts            # CLI entry: rool-app dev
│   └── dev/
│       ├── HostShell.svelte  # Dev host UI (Svelte + Tailwind)
│       ├── host-shell.ts     # Mount entry for the pre-built host bundle
│       └── app.css           # Tailwind entry
├── build/
│   └── vite.config.js        # Builds host-shell into self-contained JS bundle
└── package.json              # bin: rool-app, exports: . (svelte), ./host
```

## Local dev shell

Part of the `@rool-dev/app` package. Run with `npx rool-app dev` (or `pnpm dev` in the app project).

The dev shell:

- Uses Vite's `createServer` API to start the app's dev server programmatically
- **Provides all build plugins** — Svelte, Tailwind, and the app entry synthesizer. Apps do not need a `vite.config.js`
- **Synthesizes `index.html` and the entry module** — mounts `App.svelte`, calls `initApp()`, injects Tailwind
- Injects a connect middleware plugin that serves the host shell at `/__rool-host/`
- The host shell is a Svelte + Tailwind app pre-built into a single JS bundle at publish time
- Handles auth (redirects to login), space selection (persisted in localStorage), and channel setup
- Opens a channel on a real space with the same bridge protocol as production
- **Manifest watching**: `fs.watch` on `rool-app.json`, with Vite HMR full-reload on change
- **Manifest validation**: reports missing/invalid manifests in the sidebar and terminal without crashing
- App runs in the same Vite dev server (single port), getting full HMR

The dev shell must be identical to the production host in how it communicates with the app. This ensures that anything working in dev will work in prod.

## Publishing

1. Developer builds the app (`index.html` + `app.js` + `rool-app.json`)
2. Publishes to the Rool platform via CLI: `rool app publish <name> <dir>`
3. Served from `https://{appId}.dev.rool.app/`
4. Console loads it in an iframe when the user opens the app

## Current status

Working end-to-end:

- Bridge protocol between host iframe and app
- `@rool-dev/app` package with reactive `initApp()` and `ReactiveAppChannel`
- `createBridgeHost()` for the host side (used by dev shell, will be used by console)
- Dev shell with Svelte + Tailwind UI, manifest watching, space persistence
- Synthesized app entry — apps are just `App.svelte` + `rool-app.json`
- Dev CLI provides Svelte, Tailwind, and Vite plugins — no user config needed
- Dummy app (`examples/dummy-app/`) demonstrating the minimal two-file contract
- Channel name and system instruction synced from manifest

## Future work

- **Capabilities enforcement**: Bridge host restricts methods based on manifest capabilities
- **Build command**: `rool-app build` produces a production bundle
- **Server-side builds**: Push source to the Rool server; server builds with a fixed Vite config. Enables: open source enforcement, quality checks, SDK update responsibility, and AI-generated apps
- **Publish command**: `rool-app publish` uploads source to the platform
- **Tailwind design system**: Shared design tokens / theme enforcement for apps
- **Responsive validation**: Dev shell validates app layout at different viewport sizes
- **Channel ACL**: Channels become trust boundaries with tool restrictions
- **App marketplace**: Discover, install, and manage apps within spaces
