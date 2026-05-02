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
| `extension create [name]` | Create a new Rool extension |
| `extension dev` | Start the dev server |
| `extension build` | Build the extension |
| `extension upload` | Build and upload the extension to your library (`-p`/`--publish` to also publish to the marketplace) |
| `extension list` | List your extensions |
| `extension delete <extension-id>` | Delete an extension permanently |
| `extension publish-public <extension-id>` | Publish an extension to the public marketplace |
| `extension unpublish <extension-id>` | Remove an extension from the public marketplace |
| `chat [prompt]` | Chat with a space (interactive if no prompt) |
| `media upload <file>` | Upload a file to a space and create an object with the media URL |
| `space list` | List all spaces |
| `space create <name>` | Create a new space |
| `space delete <name>` | Delete a space |
| `user` | Show current user info |
| `logout` | Log out |

### Global Options

| Option | Description |
|--------|-------------|
| `-e, --env <environment>` | Target environment (`local`, `dev`, `prod`) |
| `-V, --version` | Show version number |
| `-h, --help` | Show help for any command |

### Command Options

| Option | Description | Default | Used by |
|--------|-------------|---------|---------|
| `-s, --space <name>` | space name | `Rool CLI` | `chat`, `media upload` |
| `-c, --channel <id>` | channel ID | `rool-dev` | `chat` |
| `-m, --message <text>` | optional comment/description |  | `media upload` |
| `-y, --yes` | skip confirmation prompt |  | `space delete` |

### Examples

```bash
# Create a new extension
rool extension create my-extension

# Start the dev server
rool extension dev

# Build the extension
rool extension build

# Build and upload the extension to your library
rool extension upload

# Upload and also publish to the public marketplace
rool extension upload --publish

# List your extensions
rool extension list

# Publish an already-uploaded extension to the marketplace
rool extension publish-public my-extension

# Remove an extension from the marketplace
rool extension unpublish my-extension

# Chat with the default space
rool chat "What is the capital of France?"

# Interactive chat mode
rool chat

# Use a specific space
rool chat -s "My Project" "Summarize the current state"

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
