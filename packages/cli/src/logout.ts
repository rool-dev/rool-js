import { type Command } from 'commander';
import { getClient } from './client.js';
import { DEFAULT_API_URL } from './constants.js';

export function registerLogout(program: Command): void {
  program
    .command('logout')
    .description('Log out')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .addHelpText('after', `
Examples:
  # Log out
  $ rool logout`)
    .action(async (opts: { url: string }) => {
      const client = await getClient(opts.url, { autoLogin: false });
      try {
        if (!await client.isAuthenticated()) {
          console.log('Not logged in.');
        } else {
          client.logout();
          console.log('Logged out.');
        }
      } finally {
        client.destroy();
      }
    });
}
