import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import { parseArgs } from './args.js';

export async function user(args: string[]): Promise<void> {
  const { url: apiUrl, rest } = parseArgs(args);

  if (rest.length > 0) {
    console.error('Usage: rool user [options]');
    console.error('');
    console.error('Options:');
    console.error('  -u, --url <url>    API URL (default: https://api.rool.dev)');
    process.exit(1);
  }

  const authProvider = new NodeAuthProvider();
  const client = new RoolClient({ baseUrl: apiUrl, authProvider });

  if (!await client.isAuthenticated()) {
    console.log('Not logged in.');
    client.destroy();
    process.exit(1);
  }

  const currentUser = await client.getCurrentUser();

  console.log(`Email:   ${currentUser.email}`);
  console.log(`Name:    ${currentUser.name ?? '(not set)'}`);
  console.log(`Plan:    ${currentUser.plan}`);
  console.log(`Credits: ${currentUser.creditsBalance}`);

  client.destroy();
}
