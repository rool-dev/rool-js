# Rool App

A vanilla TypeScript app built on Rool Spaces - a persistent, collaborative environment for AI-driven object management.

## Technology Stack

- **Language**: TypeScript
- **Styling**: TailwindCSS v4
- **Bundler**: Vite
- **Package manager**: pnpm

For Rool documentation, **always read the README first**:

```
node_modules/@rool-dev/sdk/README.md
```

## Rool Primitives

**RoolClient** - Authentication and space lifecycle. One per app.

**RoolSpace** - The workspace. Contains objects, relations, and conversations.
- `space.prompt(text)` - Invoke AI to create/modify objects
- `space.checkpoint()` - Create undo point before mutations
- `space.on(event, handler)` - Subscribe to real-time events
- `space.findObjects({ where? })` - Query objects

**Objects** - Key-value records with `id` field. Created via `space.createObject()` or AI.

**Relations** - Directional links between objects via `space.link(source, relation, target)`.

## Event-Driven Pattern

The SDK emits events for all changes. Build reactive UIs by subscribing:

```typescript
space.on('objectCreated', ({ objectId, object, source }) => {
  // source: 'local_user' | 'remote_user' | 'remote_agent' | 'system'
  updateUI(object);
});

space.on('objectUpdated', ({ objectId, object }) => { ... });
space.on('objectDeleted', ({ objectId }) => { ... });
space.on('linked', ({ sourceId, relation, targetId }) => { ... });
space.on('unlinked', ({ sourceId, relation, targetId }) => { ... });
```

## Key Pattern

```typescript
// Always checkpoint before AI mutations for undo support
await space.checkpoint();
const { message, objects } = await space.prompt('Create a task');
```

## Entry Point

`src/main.ts` - Single file with auth, rendering, and event handlers.

## Adding Functionality

Useful packages:
- **marked** - Render markdown from AI responses
