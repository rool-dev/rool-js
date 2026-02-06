import * as readline from 'node:readline';
import { parseArgs } from './args.js';
import { getClient } from './client.js';

function printUsage(): void {
  console.error('Usage: rool space <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  list                 List all spaces');
  console.error('  create <name>        Create a new space');
  console.error('  delete <name> [-y]   Delete a space');
  console.error('');
  console.error('Options:');
  console.error('  -u, --url <url>      API URL (default: https://api.rool.dev)');
  console.error('  -y, --yes            Skip confirmation prompt');
}

async function confirm(message: string): Promise<boolean> {
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

async function createSpace(apiUrl: string, name: string): Promise<void> {
  const client = await getClient(apiUrl);
  try {
    const newSpace = await client.createSpace(name);
    console.log(`Created space: ${newSpace.id}  ${newSpace.name}`);
    newSpace.close();
  } finally {
    client.destroy();
  }
}

async function deleteSpace(apiUrl: string, name: string, skipConfirm: boolean): Promise<void> {
  const client = await getClient(apiUrl);
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

    if (!skipConfirm) {
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
}

export async function space(args: string[]): Promise<void> {
  const { url: apiUrl, rest } = parseArgs(args);
  const [subcommand, ...subargs] = rest;

  // Check for -y/--yes flag in remaining args
  const yesIndex = subargs.findIndex(a => a === '-y' || a === '--yes');
  const skipConfirm = yesIndex !== -1;
  if (skipConfirm) {
    subargs.splice(yesIndex, 1);
  }

  switch (subcommand) {
    case 'list':
    case undefined:
      await listSpaces(apiUrl);
      break;

    case 'create': {
      const name = subargs.join(' ');
      if (!name) {
        console.error('Usage: rool space create <name>');
        process.exit(1);
      }
      await createSpace(apiUrl, name);
      break;
    }

    case 'delete': {
      const name = subargs.join(' ');
      if (!name) {
        console.error('Usage: rool space delete <name> [-y]');
        process.exit(1);
      }
      await deleteSpace(apiUrl, name, skipConfirm);
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }
}
