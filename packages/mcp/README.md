# Rool MCP Server

MCP server for the [Rool](https://rool.dev) platform. Gives AI coding agents access to Rool spaces, chat, objects, media, and app publishing.

## Setup

| Variable | Description | Default |
|----------|-------------|---------|
| `ROOL_ENV` | Preset environment: `prod`, `dev`, `local` | `prod` |
| `ROOL_API_URL` | Custom API base URL (overrides `ROOL_ENV`) | — |
| `ROOL_CREDENTIALS_PATH` | Custom path for credential storage | `~/.config/rool/` |

### Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "rool": {
      "command": "npx",
      "args": ["-y", "@rool-dev/mcp"]
    }
  }
}
```

### OpenCode

Add to your `opencode.json`:

```json
{
  "mcp": {
    "rool": {
      "type": "local",
      "command": ["npx", "-y", "@rool-dev/mcp"]
    }
  }
}
```

### Global install (optional)

If you prefer a global install instead of `npx`:

```bash
npm install -g @rool-dev/mcp
```

Then use `rool-mcp` as the command instead of `npx -y @rool-dev/mcp`.

## Authentication

On first use, the server opens your browser to authenticate. Credentials are stored in `~/.config/rool/` and shared with the [Rool CLI](https://www.npmjs.com/package/@rool-dev/cli).

If you've already authenticated with the CLI (`rool chat`), the MCP server will reuse those credentials.

## Tools

The server exposes 22 tools:

| Category | Tool | Description |
|----------|------|-------------|
| Space | `rool_list_spaces` | List all accessible spaces |
| Space | `rool_create_space` | Create a new space |
| Space | `rool_delete_space` | Delete a space (irreversible) |
| Chat | `rool_chat` | Send a prompt to a space and get an AI response |
| Schema | `rool_get_schema` | Get the collection schema for a space |
| Schema | `rool_create_collection` | Create a new collection (defines the shape of objects) |
| Schema | `rool_alter_collection` | Alter a collection, replacing its field definitions |
| Schema | `rool_drop_collection` | Drop a collection schema |
| Object | `rool_get_object` | Get an object by ID |
| Object | `rool_create_object` | Create a new object (supports `{{placeholders}}` for AI-generated content) |
| Object | `rool_update_object` | Update an object by ID or with an AI prompt |
| Object | `rool_delete_objects` | Delete one or more objects |
| Object | `rool_find_objects` | Find objects with structured filters and/or natural language |
| Object | `rool_list_objects` | List object IDs sorted by modification time |
| Conversation | `rool_list_conversations` | List all conversations in a space |
| Conversation | `rool_rename_conversation` | Rename a conversation |
| Conversation | `rool_delete_conversation` | Delete a conversation and its history |
| Media | `rool_upload_media` | Upload a local file to a space |
| Media | `rool_list_media` | List all media files in a space |
| App | `rool_list_apps` | List published apps |
| App | `rool_publish_app` | Publish a directory as an app at `https://{app_id}.rool.app/` |
| App | `rool_unpublish_app` | Unpublish an app |

## License

MIT — see [LICENSE](../../LICENSE) for details.
