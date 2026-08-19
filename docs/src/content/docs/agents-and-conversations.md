---
title: Agents and conversations
---

An agent is a reusable set of instructions on one machine. A conversation is its persistent history with that agent. Every machine has the general `rool` agent, and apps can create additional agents for narrower jobs.

Custom `system` instructions are added to Rool's built-in machine context; they do not need to explain how to access the machine. An agent definition can be replaced later without changing its existing conversations. Conversation-specific instructions are available when one thread needs extra context without changing the agent.

## Conversations

A conversation is **private** to its creator by default. A **shared** conversation is visible to the machine's members. Names and visibility can be changed without changing its turns.

`prompt()` returns once Rool accepts the run. The run belongs to the machine, so it continues if the client disconnects. Attachments are paths to existing files under `/space` or `/rool-drive`; upload the file first rather than passing its bytes to `prompt()`.

Prompt options can select an effort, request output matching a JSON Schema, or replace a previous user turn. Structured responses appear as a `json` content part. Conversation content may also contain text, attachments, tool calls, and tool results, so consumers should switch on each part's `type`.

## Follow a run or watch a conversation

Use `follow()` when handling one current run directly. It emits output parts and a final completed, cancelled, or error event, then resolves. Calling it again can reconnect to work still running on the machine. `cancel()` asks the current run to stop.

For a UI, `watch()` is usually simpler:

```typescript
const stop = conversation.watch((view) => {
  renderConversation(view.turns, view.output, view.isRunning);
});
```

The view combines saved turns with live output and updates after reconnects or changes from another client. `loading` covers the initial read and `error` reports the current watch failure. Stop the watch when its screen is no longer active.

Use `get()` for metadata and turns together, `listTurns()` for saved history, and `listConversations()` for lightweight conversation rows. Agent runs and conversations use the same machine permissions as other writable machine data.
