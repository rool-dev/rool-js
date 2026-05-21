# Rool JavaScript

Official TypeScript SDK and extension toolkit for working with [Rool](https://rool.dev) Spaces.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@rool-dev/sdk](./packages/sdk) | TypeScript SDK for building Rool applications | [![npm](https://img.shields.io/npm/v/@rool-dev/sdk)](https://www.npmjs.com/package/@rool-dev/sdk) |
| [@rool-dev/svelte](./packages/svelte) | Svelte 5 bindings for the SDK | [![npm](https://img.shields.io/npm/v/@rool-dev/svelte)](https://www.npmjs.com/package/@rool-dev/svelte) |
| [@rool-dev/extension](./packages/extension) | Extension SDK and CLI for building Rool extensions | [![npm](https://img.shields.io/npm/v/@rool-dev/extension)](https://www.npmjs.com/package/@rool-dev/extension) |

## Quick Start

### Extension

```bash
npx @rool-dev/extension init my-extension
cd my-extension
npm install
npx rool-extension build
```

See the [Extension documentation](./packages/extension/README.md) for full API reference and CLI usage.

### SDK

```bash
npm install @rool-dev/sdk
```

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient();

const space = await client.createSpace('My Space');
await space.createObject({
  data: { type: 'note', content: '{{write something interesting}}' }
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
