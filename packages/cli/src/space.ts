import * as readline from 'node:readline';
import { type Command } from 'commander';
import { getClient } from './client.js';
import { DEFAULT_API_URL } from './constants.js';

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
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (opts: { url: string }) => {
      await listSpaces(opts.url);
    });

  space
    .command('list')
    .description('List all spaces')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (opts: { url: string }) => {
      await listSpaces(opts.url);
    });

  space
    .command('create')
    .description('Create a new space')
    .argument('<name>', 'space name')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (name: string, opts: { url: string }) => {
      const client = await getClient(opts.url);
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
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (name: string, opts: { yes?: boolean; url: string }) => {
      const client = await getClient(opts.url);
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

async function listSpaces(apiUrl: string): Promise<void> {
  const client = await getClient(apiUrl);
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
