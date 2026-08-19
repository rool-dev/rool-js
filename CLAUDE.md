# Rool SDK

Official TypeScript SDK for Rool Machines. Published as `@rool-dev/sdk`.

## Structure

- `src/client.ts` — public client and HTTP problem handling
- `src/auth-node.ts` — Node.js login and credential refresh
- `src/types.ts` — public wire types
- `test/integration/v2/` — local integration smoke tests
- `docs/` — documentation site

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm test:v2
pnpm docs:build
```

Use `pnpm release <version>` to prepare a release; pushing the resulting tag publishes it.

The README is duplicated into `docs/src/content/docs/index.md`. Do not edit that generated file.

## Design

Prioritize developer ergonomics, consistent patterns, discoverability, and simplicity. Build API functionality in vertical slices with local integration smoke tests under `test/integration/v2/`.
