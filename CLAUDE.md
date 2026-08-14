# rool-js

Official TypeScript SDK and Svelte bindings for Rool. This is a pnpm monorepo.

## Packages

| Package         | Path               | npm                |
| --------------- | ------------------ | ------------------ |
| SDK             | `packages/sdk/`    | `@rool-dev/sdk`    |
| Svelte bindings | `packages/svelte/` | `@rool-dev/svelte` |

Read the package-specific `CLAUDE.md` before working in a package.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm docs:build
```

Packages share one version and are published together. Use `pnpm release <version>` to prepare a release; pushing the resulting tag publishes it.

Package READMEs are the source for `docs/src/content/docs/sdk.md` and `svelte.md`. Do not edit those generated files.
