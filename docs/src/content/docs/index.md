---
title: Rool Documentation
description: Build on Rool Machines — TypeScript SDK and Svelte 5 bindings for programmatic access to your private AI computer.
---

A [Rool Machine](https://rool.dev) is a private AI computer in the cloud: a virtual machine that holds Objects, files, conversations, and memory, with an AI agent running inside it. The AI operates on a structured world model — objects, schema, references, files — not just a text transcript.

Everything a Machine contains is accessible programmatically. These docs cover the developer tools for building on top of it.

> **Naming note:** the SDK predates the Rool Machine branding and calls a Machine a **space** (`createSpace`, `RoolSpace`, `/space/...` paths). The API will move to Machine terminology in v2; until then, read "space" as "Machine" throughout the API.

## What you can build

- **Apps with live shared state** — objects sync in real time over SSE to every person and AI working in the same Machine.
- **AI features without plumbing** — prompt the Machine's agent from your code; it reads and mutates structured objects, no model setup or API keys.
- **File-backed tools** — every Machine has WebDAV file storage with sync, locks, and range reads.
- **Team workspaces** — invites, roles, and collaboration are built in; your app inherits them.

## Quick Start

```bash
npm install @rool-dev/sdk
```

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient();

if (!(await client.initialize())) {
  await client.login('My App'); // browser auth redirects; re-run after callback
}

const machine = await client.createSpace('Reading List'); // a "space" is a Machine
await machine.createCollection('book', [
  { name: 'title', type: { kind: 'string' } },
  { name: 'read', type: { kind: 'boolean' } },
]);

await machine.putObject('/space/book/dune.json', { title: 'Dune', read: false });

const { message } = await machine
  .conversation('main')
  .prompt('Add five classic sci-fi novels to my reading list.');

console.log(message);
```

## Developer Tools

### SDK

The TypeScript SDK: auth, Machines, objects and schema, AI prompting, conversations, WebDAV files, real-time events, invites, undo/redo, import/export. Works in the browser and Node.js.

[Read SDK Docs](/sdk/)

### Svelte

Svelte 5 bindings on top of the SDK: reactive Machines, object watches, conversation handles, and a live file tree — all `$state`-based, no stores.

[Read Svelte Docs](/svelte/)

## Try Rool first

If you haven't used Rool yet, sign up at [rool.app](https://rool.app) and get a feel for the product: chat with your Machine, add some objects, upload files. The SDK exposes the same primitives you see there.

More about Rool: [rool.dev](https://rool.dev) · [FAQ](https://rool.dev/faq) · [GitHub](https://github.com/rool-dev/rool-js)
