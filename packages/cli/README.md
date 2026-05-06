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
| `-c, --channel <id>` | channel ID | `rool-dev` | `chat` |
| `-m, --message <text>` | optional comment/description |  | `media upload` |
| `-y, --yes` | skip confirmation prompt |  | `space delete` |

### Examples

```bash
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

## License

MIT - see [LICENSE](../../LICENSE) for details.
