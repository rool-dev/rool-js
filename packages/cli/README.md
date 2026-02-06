# Rool CLI

Command-line interface for the [Rool](https://rool.dev) platform.

## Installation

```bash
npm install -g @rool-dev/cli
```

## Usage

```bash
rool <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `chat [prompt]` | Chat with a space (interactive if no prompt) |
| `media upload <file>` | Upload a file to a space and create an object with the media URL |
| `space list` | List all spaces |
| `space create <name>` | Create a new space |
| `space delete <name>` | Delete a space |
| `publish deploy <app-id> <path>` | Publish a directory as an app |
| `publish list` | List published apps |
| `publish unpublish <app-id>` | Unpublish an app |
| `publish slug [new-slug]` | Show or set your user slug |
| `user` | Show current user info |
| `logout` | Log out |

### Global Options

| Option | Description |
|--------|-------------|
| `-V, --version` | Show version number |
| `-h, --help` | Show help for any command |

### Command Options

| Option | Description | Default | Used by |
|--------|-------------|---------|---------|
| `-s, --space <name>` | space name | `Rool CLI` | `chat`, `media upload` |
| `-c, --conversation <id>` | conversation ID | `rool-dev` | `chat` |
| `-u, --url <url>` | API URL | `https://api.rool.dev` | all |
| `-m, --message <text>` | optional comment/description |  | `media upload` |
| `-y, --yes` | skip confirmation prompt |  | `space delete` |
| `-n, --name <name>` | app display name (defaults to app-id) |  | `publish deploy` |
| `--no-spa` | disable SPA routing (404s will not serve index.html) |  | `publish deploy` |

### Examples

```bash
# Chat with the default space
rool chat "What is the capital of France?"

# Interactive chat mode
rool chat

# Use a specific space
rool chat -s "My Project" "Summarize the current state"

# List your spaces
rool space list

# Create a new space
rool space create "My New Project"

# Delete a space (with confirmation)
rool space delete "Old Project"

# Delete without confirmation
rool space delete "Old Project" -y

# Upload a file
rool media upload photo.jpg

# Upload with a comment
rool media upload report.pdf -m "Q4 sales report"

# Upload to a specific space
rool media upload logo.png -s "My Project"

# Publish a directory as an app
rool publish deploy my-app ./dist

# Publish with a custom name
rool publish deploy my-app ./dist -n "My App"

# List published apps
rool publish list

# Unpublish an app
rool publish unpublish my-app

# Show or set your user slug
rool publish slug
rool publish slug my-slug

# Show user info
rool user

# Log out
rool logout
```

## Authentication

On first use, the CLI opens your browser to authenticate. Credentials are stored in `~/.config/rool/`.

## Version

Current version: `0.1.9`. Use `rool --version` to check your installed version.

## License

MIT - see [LICENSE](../../LICENSE) for details.
