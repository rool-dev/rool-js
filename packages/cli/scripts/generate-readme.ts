/**
 * Generates README.md from the commander program definition.
 * Run with: npx tsx scripts/generate-readme.ts
 *
 * This is the single source of truth for CLI documentation.
 * The output README.md flows into the docs site via docs/build-docs.js.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Command } from 'commander';

interface CommandInfo {
  fullName: string;
  description: string;
  args: { name: string; required: boolean; description: string }[];
  options: { flags: string; description: string; defaultValue?: string }[];
  examples: string;
}

/**
 * Extract the 'after' help text from a Commander command by invoking its
 * afterHelp event listeners with a fake context that captures the output.
 */
function getAfterHelpText(cmd: Command): string {
  const listeners = (cmd as unknown as { listeners(event: string): ((...args: unknown[]) => void)[] }).listeners('afterHelp');
  if (listeners.length === 0) return '';

  let captured = '';
  const context = { error: false, command: cmd, write: (s: string) => { captured += s; } };
  for (const fn of listeners) {
    fn(context);
  }
  return captured.trim();
}

function collectCommands(cmd: Command, prefix: string = ''): CommandInfo[] {
  const result: CommandInfo[] = [];

  for (const sub of cmd.commands) {
    // Skip hidden commands (like the "spaces" alias and "help")
    if ((sub as unknown as { _hidden: boolean })._hidden) continue;
    if (sub.name() === 'help') continue;

    const fullName = prefix ? `${prefix} ${sub.name()}` : sub.name();
    const visibleSubCommands = sub.commands.filter(
      (c: Command) => !(c as unknown as { _hidden: boolean })._hidden && c.name() !== 'help',
    );

    if (visibleSubCommands.length > 0) {
      // This is a command group — recurse into subcommands
      result.push(...collectCommands(sub, fullName));
    } else {
      // This is a leaf command
      const args = (
        sub as unknown as {
          registeredArguments: { name: () => string; required: boolean; description: string }[];
        }
      ).registeredArguments.map((a) => ({
        name: a.name(),
        required: a.required,
        description: a.description,
      }));

      const options = sub.options
        .filter((o: { hidden: boolean }) => !o.hidden)
        .filter((o: { long: string }) => o.long !== '--help')
        .map((o: { flags: string; description: string; defaultValue?: unknown }) => ({
          flags: o.flags,
          description: o.description,
          defaultValue: o.defaultValue !== undefined ? String(o.defaultValue) : undefined,
        }));

      result.push({
        fullName,
        description: sub.description(),
        args,
        options,
        examples: getAfterHelpText(sub),
      });
    }
  }

  return result;
}

function formatCommand(cmd: CommandInfo): string {
  const argParts = cmd.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`));
  return `\`${cmd.fullName}${argParts.length ? ' ' + argParts.join(' ') : ''}\``;
}

function generateReadme(prog: Command): string {
  const version = prog.version();
  const commands = collectCommands(prog);

  let md = `# Rool CLI

Command-line interface for the [Rool](https://rool.dev) platform.

## Installation

\`\`\`bash
npm install -g @rool-dev/cli
\`\`\`

## Usage

\`\`\`bash
rool <command> [options]
\`\`\`

### Commands

| Command | Description |
|---------|-------------|
`;

  for (const cmd of commands) {
    md += `| ${formatCommand(cmd)} | ${cmd.description} |\n`;
  }

  // Collect all unique options across commands, grouped by flags
  const optionMap = new Map<string, { flags: string; description: string; defaultValue?: string }>();
  for (const cmd of commands) {
    for (const opt of cmd.options) {
      if (!optionMap.has(opt.flags)) {
        optionMap.set(opt.flags, opt);
      }
    }
  }

  md += `
### Global Options

| Option | Description |
|--------|-------------|
| \`-V, --version\` | Show version number |
| \`-h, --help\` | Show help for any command |

### Command Options

| Option | Description | Default | Used by |
|--------|-------------|---------|---------|
`;

  // Group options by which commands use them
  const optUsage = new Map<string, string[]>();
  for (const cmd of commands) {
    for (const opt of cmd.options) {
      const users = optUsage.get(opt.flags) ?? [];
      users.push(cmd.fullName);
      optUsage.set(opt.flags, users);
    }
  }

  for (const [flags, opt] of optionMap) {
    const users = optUsage.get(flags) ?? [];
    const defaultStr = opt.defaultValue ? `\`${opt.defaultValue}\`` : '';

    // Shorten the "used by" column
    let usedBy: string;
    if (users.length === commands.length) {
      usedBy = 'all';
    } else {
      usedBy = users.map((u) => `\`${u}\``).join(', ');
    }

    md += `| \`${flags}\` | ${opt.description} | ${defaultStr} | ${usedBy} |\n`;
  }

  // Collect examples from addHelpText('after', ...) on each command.
  // Each example is a pair of [comment, command] lines extracted from the help text.
  const exampleBlocks: string[] = [];
  for (const cmd of commands) {
    if (!cmd.examples) continue;
    // Parse comment/command pairs from the help text (skip the "Examples:" header)
    const lines = cmd.examples
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('#') || l.startsWith('$'));

    let currentComment = '';
    for (const line of lines) {
      if (line.startsWith('#')) {
        currentComment = line;
      } else if (line.startsWith('$')) {
        const command = line.replace(/^\$\s*/, '');
        const block = currentComment ? `${currentComment}\n${command}` : command;
        exampleBlocks.push(block);
        currentComment = '';
      }
    }
  }

  if (exampleBlocks.length > 0) {
    md += `
### Examples

\`\`\`bash
${exampleBlocks.join('\n\n')}
\`\`\`
`;
  }

  md += `
## Authentication

On first use, the CLI opens your browser to authenticate. Credentials are stored in \`~/.config/rool/\`.

## Version

${version ? `Current version: \`${version}\`. ` : ''}Use \`rool --version\` to check your installed version.

## License

MIT - see [LICENSE](../../LICENSE) for details.
`;

  return md;
}

async function main() {
  // Import from program.js (not index.js which has the parseAsync side effect)
  const { createProgram } = await import('../dist/program.js');
  const prog = (createProgram as () => Command)();

  const readme = generateReadme(prog);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const readmePath = join(__dirname, '..', 'README.md');
  writeFileSync(readmePath, readme);
  console.log(`Generated: ${readmePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
