# rool-mcp

MCP server for the Rool platform. Published as `@rool-dev/mcp`.

Exposes Rool spaces, chat, objects, media, and app publishing as MCP tools
via stdio transport. Compatible with Claude Code and other MCP clients.

## Structure
- `src/index.ts` - Server entry point (shebang binary at `rool-mcp`)
- `src/client.ts` - Singleton RoolClient with NodeAuthProvider
- `src/utils.ts` - Channel caching, space resolution, MCP result helpers
- `src/types.ts` - Re-exports from SDK and MCP SDK
- `src/tools/chat.ts` - Chat/prompt tool (1 tool)
- `src/tools/spaces.ts` - Space management tools (3 tools)
- `src/tools/schema.ts` - Schema/collection tools (4 tools)
- `src/tools/objects.ts` - Object CRUD tools (6 tools)
- `src/tools/conversations.ts` - Conversation management tools (3 tools)
- `src/tools/media.ts` - Media upload/list tools (2 tools)
- `src/tools/apps.ts` - App publishing tools (3 tools)

## Commands
- `pnpm build` - Compile TypeScript
- `pnpm typecheck` - Type check without emitting

## Configuration
- `ROOL_API_URL` — custom API base URL (takes precedence over `ROOL_ENV`)
- `ROOL_ENV` — preset environment: `prod` (default), `dev`, `local`
- `ROOL_CREDENTIALS_PATH` — custom credential storage path (default: `~/.config/rool/`)
