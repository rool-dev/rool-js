import * as readline from 'node:readline';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { type Environment } from './constants.js';

function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export function registerSpace(program: Command): void {
  const space = program
    .command('space')
    .description('Manage spaces (list, create, delete)');

  // "rool spaces" alias for "rool space list"
  program
    .command('spaces', { hidden: true })
    .description('List all spaces (alias for "space list")')
    .action(async (_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      await listSpaces(env);
    });

  space
    .command('list')
    .description('List all spaces')
    .addHelpText('after', `
Examples:
  # List your spaces
  $ rool space list`)
    .action(async (_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      await listSpaces(env);
    });

  space
    .command('create')
    .description('Create a new space')
    .argument('<name>', 'space name')
    .addHelpText('after', `
Examples:
  # Create a new space
  $ rool space create "My New Project"`)
    .action(async (name: string, _opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
      try {
        const newSpace = await client.createSpace(name);
        console.log(`Created space: ${newSpace.id}  ${newSpace.name}`);
        newSpace.close();
      } finally {
        client.destroy();
      }
    });

  space
    .command('delete')
    .description('Delete a space')
    .argument('<name>', 'space name')
    .option('-y, --yes', 'skip confirmation prompt')
    .addHelpText('after', `
Examples:
  # Delete a space (with confirmation)
  $ rool space delete "Old Project"

  # Delete without confirmation
  $ rool space delete "Old Project" -y`)
    .action(async (name: string, opts: { yes?: boolean }, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env);
      try {
        const list = await client.listSpaces();
        const spaceInfo = list.find(s => s.name === name);

        if (!spaceInfo) {
          console.error(`Space not found: "${name}"`);
          process.exit(1);
        }

        if (spaceInfo.role !== 'owner') {
          console.error(`Cannot delete space: you are not the owner (role: ${spaceInfo.role})`);
          process.exit(1);
        }

        if (!opts.yes) {
          const confirmed = await confirm(`Delete space "${name}" (${spaceInfo.id})? This cannot be undone.`);
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        await client.deleteSpace(spaceInfo.id);
        console.log(`Deleted space: ${name}`);
      } finally {
        client.destroy();
      }
    });
}

async function listSpaces(env: Environment): Promise<void> {
  const client = await getClient(env);
  try {
    const list = await client.listSpaces();

    if (list.length === 0) {
      console.log('No spaces found.');
    } else {
      for (const s of list) {
        console.log(`${s.id}  ${s.name}  (${s.role})`);
      }
    }
  } finally {
    client.destroy();
  }
}
