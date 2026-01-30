# Rool CLI

Command-line interface for the [Rool](https://api.rool.dev) platform.

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
| `chat <prompt>` | Send a prompt to a space |
| `chat` | Interactive chat mode |
| `media upload <file>` | Upload a file and create an object with the media URL |
| `space list` | List all spaces |
| `space create <name>` | Create a new space |
| `space delete <name>` | Delete a space |
| `user` | Show current user info |
| `logout` | Log out |

### Options

| Option | Description |
|--------|-------------|
| `-s, --space <name>` | Space name (default: "Rool CLI") |
| `-c, --conversation <id>` | Conversation ID (default: "rool-dev") |
| `-u, --url <url>` | API URL (default: https://api.rool.dev) |
| `-m, --message <text>` | Comment/description (for media upload) |
| `-y, --yes` | Skip confirmation prompts |

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

# Show user info
rool user

# Log out
rool logout
```

## Authentication

On first use, the CLI opens your browser to authenticate. Credentials are stored in `~/.config/rool/`.

## License

Proprietary - © Rool Limited. All rights reserved.
