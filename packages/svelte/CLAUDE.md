# rool-svelte

Svelte 5 runes for the Rool platform. Published as `@rool-dev/svelte`.

@README.md — Full API documentation and usage patterns

## Structure
- `src/index.ts` - Main export: createRool()
- `src/rool.svelte.ts` - Rool class with $state reactivity
- `src/space.svelte.ts` - SpaceHandle class and AsyncValue
- `src/types.ts` - TypeScript type re-exports

## Commands
- `pnpm build` - Compile with svelte-package
- `pnpm typecheck` - Type check with svelte-check

## Design Principles
- Uses Svelte 5 runes ($state) for reactivity
- No Svelte stores - direct property access is reactive
- Go through the API — never expose raw space data
- Auto-refresh where safe — object/children/parents auto-refresh; query is manual
- Store caching — factory functions return cached instances by arguments

## Svelte 5 Only
This package requires Svelte 5. It uses `.svelte.ts` files with runes that are compiled by the consumer's bundler.
