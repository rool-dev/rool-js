# rool-js

Official TypeScript SDK and CLI for the Rool platform. This is a pnpm monorepo.

## Packages

| Package | Path | npm |
|---------|------|-----|
| @rool-dev/sdk | `packages/sdk/` | TypeScript SDK |
| @rool-dev/cli | `packages/cli/` | Command-line interface |
| @rool-dev/svelte | `packages/svelte/` | Svelte wrapper |
| @rool-dev/mcp | `packages/mcp/` | MCP server |

## Commands
- `pnpm install` - Install all dependencies
- `pnpm build` - Build all packages
- `pnpm typecheck` - Type check all packages

## Package-specific instructions
- @packages/sdk/CLAUDE.md
- @packages/cli/CLAUDE.md
- @packages/mcp/CLAUDE.md

## Development
The CLI and MCP server depend on the SDK via `workspace:*`. Changes to the SDK are immediately available during development.

```bash
pnpm install
pnpm build
```

## Docs Site
The `docs/` folder is a Starlight (Astro) site. The SDK, CLI, and Svelte doc pages are **generated from package READMEs** by `docs/build-docs.js` at build time (`pnpm docs:build`). The generated files (`docs/src/content/docs/{sdk,cli,svelte}.md` and `docs/public/llms.txt`) are gitignored. Static pages like `index.md` and `console.md` are checked in directly. **Do not edit the generated doc pages — edit the package READMEs instead.**

## Publishing
All packages share a single version number and are published together under the `@rool-dev` scope.

```bash
pnpm release 0.2.0          # bumps all package.json files, commits, and tags v0.2.0
git push origin main --tags  # triggers CI to publish all packages
```
