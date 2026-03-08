# rool-js

Official TypeScript SDK and CLI for the Rool platform. This is a pnpm monorepo.

## Packages

| Package | Path | npm |
|---------|------|-----|
| @rool-dev/sdk | `packages/sdk/` | TypeScript SDK |
| @rool-dev/cli | `packages/cli/` | Command-line interface |
| @rool-dev/svelte | `packages/svelte/` | Svelte wrapper |

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
All packages share a single version number and are published together under the `@rool-dev` scope.

```bash
pnpm release 0.2.0          # bumps all package.json files, commits, and tags v0.2.0
git push origin main --tags  # triggers CI to publish all packages
```
