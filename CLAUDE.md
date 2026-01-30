# rool-js

Official TypeScript SDK and CLI for the Rool platform. This is a pnpm monorepo.

## Packages

| Package | Path | npm |
|---------|------|-----|
| @rool-dev/sdk | `packages/sdk/` | TypeScript SDK |
| @rool-dev/cli | `packages/cli/` | Command-line interface |

## Commands
- `pnpm install` - Install all dependencies
- `pnpm build` - Build all packages
- `pnpm typecheck` - Type check all packages

## Package-specific instructions
- @packages/sdk/CLAUDE.md
- @packages/cli/CLAUDE.md

## Development
The CLI depends on the SDK via `workspace:*`. Changes to the SDK are immediately available to the CLI during development.

```bash
pnpm install
pnpm build
```

## Publishing
Packages are published independently to npm under the `@rool-dev` scope.
