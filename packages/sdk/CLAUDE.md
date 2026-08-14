# Rool SDK

TypeScript SDK for Rool Machines. Published as `@rool-dev/sdk`.

## Structure

- `src/client.ts` — public client and HTTP problem handling
- `src/auth-node.ts` — Node.js login and credential refresh
- `src/types.ts` — public wire types
- `test/integration/v2/` — local integration smoke tests

## Commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:v2
```

## Design

Prioritize developer ergonomics, consistent patterns, discoverability, and simplicity. Build API functionality in vertical slices with local integration smoke tests under `test/integration/v2/`.
