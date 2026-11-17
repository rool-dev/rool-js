---
title: Rool SDK
---

<p><code>v5.3.0</code></p>

<p align="center" class="sdk-brand"><a href="https://rool.dev"><img class="sdk-brand-logo" src="/sdk-assets/rool-logo.svg" alt="Rool logo" width="44" height="44"><picture><source media="(prefers-color-scheme: dark)" srcset="/sdk-assets/rool-wordmark-dark.svg"><img class="sdk-brand-wordmark" src="/sdk-assets/rool-wordmark.svg" alt="Rool" width="128"></picture></a></p>

<h1 align="center" class="sdk-title">TypeScript SDK</h1>

The official TypeScript SDK for building apps and automations with [Rool Machines](https://rool.dev).

A Rool Machine is a cloud VM with snapshots, files, and built-in AI. The SDK provides one typed interface for authentication, machine management, file access, conversations, and live updates.

## Installation

```bash
npm install @rool-dev/sdk
```

## Connect from Node.js

`NodeAuth` opens the user's browser for login, stores their credentials locally, and refreshes them when needed.

```typescript
import { RoolClient } from "@rool-dev/sdk";
import { NodeAuth } from "@rool-dev/sdk/node";

const auth = new NodeAuth();
if (!(await auth.initialize())) {
  await auth.login("My app");
}

const client = new RoolClient({
  getTokens: auth.getTokens,
  onAuthInvalidated: auth.logout,
});
```

The package also includes:

- `BrowserAuth` for web apps using browser redirects and browser storage.
- `NativeAuth` for mobile apps that open sign-in in the system browser and return through a deep link. It also supports passwords and magic links.

## Put a machine to work

This example creates a machine, gives a conversation instructions, uploads a receipt, and asks Rool to file it. The file API writes to the machine's WebDAV storage, so Rool and the app see the same files.

```typescript
import { readFile } from "node:fs/promises";

const created = await client.createMachine({ name: "Receipts" });
const machine = client.machine(created.id);

const conversation = await machine.createConversation({
  name: "Receipt inbox",
  visibility: "private",
});
await conversation.replaceInstructions(
  "File receipt attachments under /rool-drive/receipts. " +
    "Choose useful subfolders based on the receipt's contents.",
);

const receiptPath = "/rool-drive/receipts/unsorted/receipt.pdf";
await machine.files.write(receiptPath, await readFile("./receipt.pdf"), {
  contentType: "application/pdf",
  createParents: true,
});

await conversation.prompt("File this receipt.", {
  attachments: [receiptPath],
});
await conversation.follow({
  onEvent(event) {
    if (event.type === "output.delta" && event.content.type === "text") {
      process.stdout.write(event.content.text);
    }
  },
});
```

Prompting is asynchronous: `prompt()` returns when Rool accepts the work, while the agent keeps running on the machine. An app can follow the current run, leave, and reconnect later. UI clients can instead watch a conversation and receive a current view as its saved turns and live output change.

For a quick task without custom instructions, `const conversation = await machine.prompt("Summarize the files in /rool-drive.")` creates a private conversation and starts its first run. Use `machine.conversation(id)` to get a handle to an existing conversation later.

## Run a Linux command

Owners and admins can execute Bash commands directly, without an agent:

```typescript
const result = await machine.exec({
  command: "cd /rool-drive && ls -la",
  timeoutMs: 30_000,
});

console.log(result.stdout);
if (result.exitCode !== 0) console.error(result.stderr);
```

Each call starts a fresh shell as your machine user, with its home as the initial directory. `exec()` collects the output and returns it when the command finishes; `execStream()` gives it as it is produced. A nonzero exit code is returned in the result; API failures throw `RoolProblem`. See [command execution](https://docs.rool.dev/machines-and-sharing/#run-linux-commands) for live output, standard input, timeouts, and cancellation.

## Give AI data your app understands

A machine can hold records as well as documents. A collection defines the fields in each record, and Rool rejects writes that do not match. For example, an app can keep an index alongside the receipt files:

```typescript
await machine.collections.create("receipts", {
  fields: [
    { name: "vendor", type: { kind: "string" } },
    { name: "amount", type: { kind: "number" } },
    { name: "currency", type: { kind: "string" } },
    { name: "document", type: { kind: "string" } },
  ],
});

await machine.objects.create("/space/receipts/cafe.json", {
  vendor: "Cafe",
  amount: 12,
  currency: "EUR",
  document: receiptPath,
});
```

The record is also a normal JSON file at `/space/receipts/cafe.json`. The app can work with it through `machine.objects`, while the agent and programs inside the machine can use normal file tools. Changes from either side enter the same watched file tree.

Collections can power task lists, catalogues, contact records, or a memory view with links between people, projects, and notes. The app gets predictable fields for its UI without hiding the data from the agent.

## What the SDK handles

- **Machines:** create, configure, duplicate, checkpoint, share, and delete VMs.
- **Files:** upload, stream, move, and watch files under `/space` and `/rool-drive`.
- **Conversations:** set instructions, keep history, attach machine files, stream runs, and request structured output.
- **Live state:** learn when account data changes, keep a file tree current, and stream conversation updates.
- **Shared app data:** define records that apps, the agent, and programs inside the machine can all read and edit.

Long-running work belongs to the machine rather than the client connection. File changes made by the app, a user, or the agent enter the same synchronized file tree, while account events tell the app when to fetch fresh account or machine data.

The package exports its public TypeScript types, so editor autocomplete shows the detailed options and results. See [docs.rool.dev](https://docs.rool.dev/) for the published documentation.

## License

MIT — see [LICENSE](https://github.com/rool-dev/rool-js/blob/main/LICENSE).
