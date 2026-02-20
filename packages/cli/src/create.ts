import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Command } from 'commander';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Framework = 'svelte' | 'vanilla';

interface CreateOptions {
  svelte?: boolean;
  vanilla?: boolean;
}

function getTemplatesDir(): string {
  // In development: packages/cli/src -> packages/cli/templates
  // In production: packages/cli/dist -> packages/cli/templates
  return path.resolve(__dirname, '..', 'templates');
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function copyDir(src: string, dest: string, replacements: [string, string][]): void {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        copyDir(srcPath, destPath, replacements);
      }
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');
      for (const [from, to] of replacements) {
        content = content.replaceAll(from, to);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}

function toValidPackageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
}

function toTitleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function registerCreate(program: Command): void {
  program
    .command('create')
    .description('Create a new Rool app')
    .argument('<name>', 'project name')
    .option('--svelte', 'use Svelte template')
    .option('--vanilla', 'use vanilla TypeScript template')
    .addHelpText('after', `
Examples:
  # Create a Svelte app
  $ rool create --svelte my-app

  # Create a vanilla TypeScript app
  $ rool create --vanilla my-app

  # Using npx
  $ npx @rool-dev/cli create --svelte my-app`)
    .action(async (name: string, opts: CreateOptions) => {
      // Determine framework
      let framework: Framework;
      if (opts.svelte && opts.vanilla) {
        console.error('Error: Cannot use both --svelte and --vanilla');
        process.exit(1);
      } else if (opts.svelte) {
        framework = 'svelte';
      } else if (opts.vanilla) {
        framework = 'vanilla';
      } else {
        console.error('Error: Please specify a framework: --svelte or --vanilla');
        process.exit(1);
      }

      // Check if directory exists
      const targetDir = path.resolve(process.cwd(), name);
      if (fs.existsSync(targetDir)) {
        console.error(`Error: Directory "${name}" already exists`);
        process.exit(1);
      }

      // Find template
      const templatesDir = getTemplatesDir();
      const templateDir = path.join(templatesDir, framework);
      if (!fs.existsSync(templateDir)) {
        console.error(`Error: Template "${framework}" not found at ${templateDir}`);
        process.exit(1);
      }

      // Copy template with replacements
      const packageName = toValidPackageName(name);
      const title = toTitleCase(name);
      console.log(`Creating ${framework} app in ${name}/...\n`);

      copyDir(templateDir, targetDir, [
        ['rool-app', packageName],
        ['Rool App', title],
        ['workspace:*', '^0.1.12'],
      ]);

      // Print next steps
      console.log(`Done! Next steps:\n`);
      console.log(`  cd ${name}`);
      console.log(`  pnpm install`);
      console.log(`  pnpm dev\n`);
      console.log(`Key patterns:`);
      if (framework === 'svelte') {
        console.log(`  • createRool() initializes the reactive client`);
        console.log(`  • rool.openSpace() connects to a space`);
        console.log(`  • space.collection() creates reactive queries`);
      } else {
        console.log(`  • new RoolClient() initializes the client`);
        console.log(`  • client.openSpace() connects to a space`);
        console.log(`  • space.on() subscribes to real-time events`);
      }
      console.log(`  • space.prompt() invokes the AI agent\n`);
      console.log(`Docs: https://docs.rool.dev`);
    });
}
