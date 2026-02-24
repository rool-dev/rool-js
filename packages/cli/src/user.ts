import { type Command } from 'commander';
import { getClient } from './client.js';
import { type Environment } from './constants.js';

export function registerUser(program: Command): void {
  program
    .command('user')
    .description('Show current user info')
    .addHelpText('after', `
Examples:
  # Show user info
  $ rool user`)
    .action(async (_opts: object, command: Command) => {
      const { env } = command.optsWithGlobals() as { env: Environment };
      const client = await getClient(env, { autoLogin: false });
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
