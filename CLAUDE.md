# rool-js

Official TypeScript SDK for Rool. This is a pnpm workspace.

## Package

| Package | Path            | npm             |
| ------- | --------------- | --------------- |
| SDK     | `packages/sdk/` | `@rool-dev/sdk` |

Read `packages/sdk/CLAUDE.md` before working in the package.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm docs:build
```

Use `pnpm release <version>` to prepare a release; pushing the resulting tag publishes it.

The package README is the source for `docs/src/content/docs/sdk.md`. Do not edit that generated file.
