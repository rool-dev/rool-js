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
| `create <name>` | Create a new Rool app |
| `media upload <file>` | Upload a file to a space and create an object with the media URL |
| `space list` | List all spaces |
| `space create <name>` | Create a new space |
| `space delete <name>` | Delete a space |
| `app publish <app-id> <path>` | Publish a directory as an app |
| `app list` | List published apps |
| `app unpublish <app-id>` | Unpublish an app |
| `app slug [new-slug]` | Show or set your user slug |
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
| `-u, --url <url>` | API URL | `https://api.rool.dev` | `chat`, `media upload`, `space list`, `space create`, `space delete`, `app publish`, `app list`, `app unpublish`, `app slug`, `user`, `logout` |
| `--svelte` | use Svelte template |  | `create` |
| `--vanilla` | use vanilla TypeScript template |  | `create` |
| `-m, --message <text>` | optional comment/description |  | `media upload` |
| `-y, --yes` | skip confirmation prompt |  | `space delete` |
| `-n, --name <name>` | app display name (defaults to app-id) |  | `app publish` |
| `--no-spa` | disable SPA routing (404s will not serve index.html) |  | `app publish` |

### Examples

```bash
# Chat with the default space
rool chat "What is the capital of France?"

# Interactive chat mode
rool chat

# Use a specific space
rool chat -s "My Project" "Summarize the current state"

# Create a Svelte app
rool create --svelte my-app

# Create a vanilla TypeScript app
rool create --vanilla my-app

# Using npx
npx @rool-dev/cli create --svelte my-app

# Upload a file
rool media upload photo.jpg

# Upload with a comment
rool media upload report.pdf -m "Q4 sales report"

# Upload to a specific space
rool media upload logo.png -s "My Project"

# List your spaces
rool space list

# Create a new space
rool space create "My New Project"

# Delete a space (with confirmation)
rool space delete "Old Project"

# Delete without confirmation
rool space delete "Old Project" -y

# Publish a directory as an app
rool app publish my-app ./dist

# Publish with a custom name
rool app publish my-app ./dist -n "My App"

# List published apps
rool app list

# Unpublish an app
rool app unpublish my-app

# Show your user slug
rool app slug

# Set your user slug
rool app slug my-slug

# Show user info
rool user

# Log out
rool logout
```

## Authentication

On first use, the CLI opens your browser to authenticate. Credentials are stored in `~/.config/rool/`.

## Version

Current version: `0.1.11`. Use `rool --version` to check your installed version.

## License

MIT - see [LICENSE](../../LICENSE) for details.
