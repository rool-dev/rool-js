---
title: Conversations
---

Conversations keep a history of your interactions with the machine’s agent. Use them to give it tasks, ask questions, and follow up on its responses. The agent can work with the machine’s files and run commands to carry out your requests.

## Start or resume a conversation

For a quick task, create a conversation and start its first run in one call:

```typescript
const conversation = await machine.prompt("Summarize the files in /rool-drive.", {
  name: "File summary",
});
```

`machine.prompt()` returns the conversation once the prompt is accepted, not when the run finishes. Its options combine conversation creation options (`id`, `name`, `visibility`) with prompt options, except `replaceTurnId`. If prompting fails after creation, the conversation remains; use explicit creation when you need a handle for cleanup or instructions before the first prompt.

```typescript
const conversation = await machine.createConversation({ name: "Receipt inbox" });
await conversation.replaceInstructions(
  "File receipt attachments under /rool-drive/receipts.",
);
await conversation.prompt("What receipts are still unsorted?");
```

Instructions supplement Rool's built-in machine context. Read them with `getInstructions()` and clear them with `replaceInstructions("")`.

Use `machine.conversation(id)` to get a cached handle without a request or server-side creation, then `conversation.prompt()` to continue that thread. `machine.listConversations()` returns lightweight conversation rows.

## Three kinds of instructions

The agent sees three sets of instructions, each under its own heading:

- **Your app's**, sent with each prompt as `appInstructions`: how your app shows an answer, or what the user has open. They hold for that prompt's run only, so a prompt from another client is not answered under your app's rules.
- **The machine's**, set with `machine.settings.setInstructions()`: what the user wants of every conversation on the machine, whichever app or channel starts it.
- **The conversation's**, set with `conversation.replaceInstructions()`: what the user wants of this one thread.

```typescript
await conversation.prompt("Summarize the report", {
  appInstructions: "Answers are shown as Markdown. Link files as rool-machine: URLs.",
});
```

Keep them apart. Text your app writes for itself does not belong in the conversation's instructions, where the user would see it as their own and other clients would inherit it.

## Visibility and prompts

A conversation is **private** to its creator by default. A **shared** conversation is visible to the machine's members. Names and visibility can be changed without changing its turns.

`prompt()` returns once Rool accepts the run. The run belongs to the machine, so it continues if the client disconnects. Attachments are paths to existing files under `/space` or `/rool-drive`; upload the file first rather than passing its bytes to `prompt()`.

Prompt options can select a `model` and one of its `effort` ids from `machine.getModels()` (the defaults apply when omitted; an `effort` needs its `model`), request output matching a JSON Schema, or replace a previous user turn. Structured responses appear as a `json` content part. Conversation content may also contain text, attachments, tool calls, and tool results, so consumers should switch on each part's `type`.

## Follow a run or watch a conversation

Use `follow()` when handling one current run directly. It emits output parts and a final completed, cancelled, or error event, then resolves. Calling it again can reconnect to work still running on the machine. `cancel()` asks the current run to stop.

For a UI, `watch()` is usually simpler:

```typescript
const stop = conversation.watch((view) => {
  renderConversation(view.turns, view.output, view.isRunning);
});
```

The view combines saved turns with live output and updates after reconnects or changes from another client. `loading` covers the initial read and `error` reports the current watch failure. Stop the watch when its screen is no longer active.

Use `conversation.get()` for metadata and turns together (`undefined` when not found), and `conversation.listTurns()` for saved history. Runs and conversations use the same machine permissions as other writable machine data.
