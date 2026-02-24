import { type Command } from 'commander';
import { getClient } from './client.js';
import { type Environment } from './constants.js';

export function registerLogout(program: Command): void {
  program
    .command('logout')
    .description('Log out')
    .addHelpText('after', `
Examples:
  # Log out
  $ rool logout`)
    .action(async (_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env, { autoLogin: false });
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
