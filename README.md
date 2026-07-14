# Rool JavaScript

Official TypeScript SDK and Svelte bindings for working with [Rool](https://rool.dev) Spaces.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@rool-dev/sdk](./packages/sdk) | TypeScript SDK for building Rool applications | [![npm](https://img.shields.io/npm/v/@rool-dev/sdk)](https://www.npmjs.com/package/@rool-dev/sdk) |
| [@rool-dev/svelte](./packages/svelte) | Svelte 5 bindings for the SDK | [![npm](https://img.shields.io/npm/v/@rool-dev/svelte)](https://www.npmjs.com/package/@rool-dev/svelte) |

## Quick Start

### SDK

```bash
npm install @rool-dev/sdk
```

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient();

const space = await client.createSpace('My Space');
await space.createCollection('note', [
  { name: 'content', type: { kind: 'string' } },
]);
await space.putObject('/space/note/welcome.json', {
  content: 'Something interesting',
});
```

See the [SDK documentation](./packages/sdk/README.md) for full API reference.

## Development

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
