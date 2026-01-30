# Rool JavaScript

Official TypeScript SDK and CLI for working with [Rool](https://rool.dev) Spaces.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@rool-dev/sdk](./packages/sdk) | TypeScript SDK for building Rool applications | [![npm](https://img.shields.io/npm/v/@rool-dev/sdk)](https://www.npmjs.com/package/@rool-dev/sdk) |
| [@rool-dev/cli](./packages/cli) | Command-line interface for Rool | [![npm](https://img.shields.io/npm/v/@rool-dev/cli)](https://www.npmjs.com/package/@rool-dev/cli) |

## Quick Start

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

### CLI

```bash
npm install -g @rool-dev/cli
rool --help
```

See the [CLI documentation](./packages/cli/README.md) for usage.

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
