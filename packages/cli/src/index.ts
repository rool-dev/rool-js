#!/usr/bin/env node
import { chat } from './chat.js';
import { media } from './media.js';
import { space } from './space.js';
import { publish } from './publish.js';
import { user } from './user.js';
import { logout } from './logout.js';
import { printCommonOptions } from './args.js';

function printUsage(): void {
  console.error('Usage: rool <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  chat [prompt]        Chat with a space (interactive if no prompt)');
  console.error('  media upload <file>  Upload a file to a space');
  console.error('  space <subcommand>   Manage spaces (list, create, delete)');
  console.error('  publish <subcommand> Publish apps (list, unpublish, slug)');
  console.error('  user                 Show current user info');
  console.error('  logout               Log out');
  console.error('');
  printCommonOptions();
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'chat':
      await chat(args);
      break;
    case 'media':
      await media(args);
      break;
    case 'space':
      await space(args);
      break;
    case 'spaces':
      // Alias: "rool spaces" = "rool space list"
      await space(['list', ...args]);
      break;
    case 'publish':
      await publish(args);
      break;
    case 'user':
      await user(args);
      break;
    case 'logout':
      await logout(args);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
