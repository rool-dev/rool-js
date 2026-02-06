import { type Command } from 'commander';
import { getClient } from './client.js';
import { DEFAULT_API_URL } from './constants.js';

export function registerUser(program: Command): void {
  program
    .command('user')
    .description('Show current user info')
    .option('-u, --url <url>', 'API URL', DEFAULT_API_URL)
    .action(async (opts: { url: string }) => {
      const client = await getClient(opts.url, { autoLogin: false });
      try {
        if (!await client.isAuthenticated()) {
          console.log('Not logged in.');
          process.exit(1);
        }

        const currentUser = await client.getCurrentUser();

        console.log(`Email:   ${currentUser.email}`);
        console.log(`Name:    ${currentUser.name ?? '(not set)'}`);
        console.log(`Plan:    ${currentUser.plan}`);
        console.log(`Credits: ${currentUser.creditsBalance}`);
      } finally {
        client.destroy();
      }
    });
}
