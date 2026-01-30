# rool-sdk

TypeScript SDK for the Rool platform. Published as `@rool-dev/sdk`.

@README.md — Full API documentation and usage patterns

## Structure
- `src/client.ts` - RoolClient: auth, space lifecycle, user storage
- `src/space.ts` - RoolSpace: objects, relations, AI prompts, undo/redo
- `src/auth-browser.ts` - Browser auth (localStorage, redirects)
- `src/auth-node.ts` - Node.js auth (file-based, opens browser)
- `src/subscription.ts` - SSE real-time sync
- `src/media.ts` - Media upload/download
- `src/graphql.ts` - GraphQL client
- `src/types.ts` - TypeScript types
- `eval/` - Evaluation framework (see below)

## Commands
- `pnpm build` - Compile TypeScript
- `pnpm typecheck` - Type check without emitting
- `pnpm eval` - Run evaluation suite (takes about 30 secs)

## Eval Framework
Located in `eval/`. Uses chai assertions. Add test cases in `eval/cases/`.
- `pnpm eval` - Run all cases
- `pnpm eval --include <pattern>` - Run cases matching pattern (substring match)
