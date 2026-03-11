# Rool JavaScript

Official TypeScript SDK, CLI, MCP server, and Svelte bindings for the [Rool](https://rool.dev) platform.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@rool-dev/sdk](./packages/sdk) | TypeScript SDK for building Rool applications | [![npm](https://img.shields.io/npm/v/@rool-dev/sdk)](https://www.npmjs.com/package/@rool-dev/sdk) |
| [@rool-dev/cli](./packages/cli) | Command-line interface for Rool | [![npm](https://img.shields.io/npm/v/@rool-dev/cli)](https://www.npmjs.com/package/@rool-dev/cli) |
| [@rool-dev/svelte](./packages/svelte) | Svelte 5 reactive bindings for Rool Spaces | [![npm](https://img.shields.io/npm/v/@rool-dev/svelte)](https://www.npmjs.com/package/@rool-dev/svelte) |
| [@rool-dev/mcp](./packages/mcp) | MCP server for AI coding agents | [![npm](https://img.shields.io/npm/v/@rool-dev/mcp)](https://www.npmjs.com/package/@rool-dev/mcp) |

## Quick Start

### SDK

```bash
npm install @rool-dev/sdk
```

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient();
await client.initialize();

const space = await client.createSpace('My Space');
await space.createObject({
  data: { type: 'note', content: '{{write something interesting}}' }
});
```

See the [SDK documentation](./packages/sdk/README.md) for full API reference.

### CLI

```bash
npm install -g @rool-dev/cli
rool --help
```

See the [CLI documentation](./packages/cli/README.md) for usage.

### Svelte

```bash
npm install @rool-dev/svelte
```

```svelte
<script>
  import { createRool } from '@rool-dev/svelte';

  const rool = createRool();
  rool.init();
</script>

{#if !rool.authenticated}
  <button onclick={() => rool.login('My App')}>Login</button>
{/if}
```

See the [Svelte documentation](./packages/svelte/README.md) for full API reference.

### MCP Server

Add to your `.mcp.json` to give AI coding agents access to Rool:

```json
{
  "mcpServers": {
    "rool": {
      "command": "npx",
      "args": ["-y", "@rool-dev/mcp"]
    }
  }
}
```

See the [MCP documentation](./packages/mcp/README.md) for setup details.

## Examples

The [`examples/`](./examples) directory contains sample applications:

- **[chat](./examples/chat)** — Interactive chat
- **[flashcards](./examples/flashcards)** — Flashcard app
- **[roodle](./examples/roodle)** — Drawing app
- **[soft-sql](./examples/soft-sql)** — Natural language SQL queries

## Development

This is a [pnpm](https://pnpm.io) monorepo. The CLI, Svelte, and MCP packages depend on the SDK via `workspace:*`, so SDK changes are immediately available during development.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type check
pnpm typecheck
```

## License

MIT - see [LICENSE](./LICENSE) for details.
