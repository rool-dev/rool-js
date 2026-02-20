# Rool App

A Svelte 5 app built on Rool Spaces - a persistent, collaborative environment for AI-driven object management.

## Technology Stack

- **Framework**: Svelte 5
- **Styling**: TailwindCSS v4
- **Language**: TypeScript
- **Package manager**: pnpm

For Rool documentation, **always read the README first**:

```
node_modules/@rool-dev/svelte/README.md  # The svelte wrapper
node_modules/@rool-dev/sdk/README.md     # The core SDK
```

## Rool Primitives

**RoolClient** - Authentication and space lifecycle. One per app.

**ReactiveSpace** - The workspace. Contains objects, relations, and conversations.
- `space.collection({ where? })` - Reactive query returning `{ objects }`
- `space.prompt(text)` - Invoke AI to create/modify objects
- `space.checkpoint()` - Create undo point before mutations
- `space.interactions` - Chat history for current conversation

**Objects** - Key-value records with `id` field. Created via `space.createObject()` or AI.

**Relations** - Directional links between objects via `space.link(source, relation, target)`.

## Key Patterns

```typescript
// Reactive collection - auto-updates when objects change
let collection = space.collection({ where: { type: 'task' } });
let tasks = $derived(collection.objects);

// AI mutation - always checkpoint first for undo
await space.checkpoint();
await space.prompt('Create a task for tomorrow');
```

Use `space.on('objectCreated', ...)` for side effects outside Svelte's reactivity.

## Entry Point

`src/main.ts` mounts `App.svelte`, which handles auth and space setup.


## Adding Functionality

Useful packages to consider:

- **@iconify/svelte** - Icons (`<Icon icon="mdi:home" />`)
- **@humanspeak/svelte-markdown** - Render markdown from AI responses
