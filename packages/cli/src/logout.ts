import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import { parseArgs } from './args.js';

export async function logout(args: string[]): Promise<void> {
  const { url: apiUrl, rest } = parseArgs(args);

  if (rest.length > 0) {
    console.error('Usage: rool logout [options]');
    console.error('');
    console.error('Options:');
    console.error('  -u, --url <url>    API URL (default: https://api.rool.dev)');
    process.exit(1);
  }

  const authProvider = new NodeAuthProvider();
  const client = new RoolClient({ baseUrl: apiUrl, authProvider });

  if (!await client.isAuthenticated()) {
    console.log('Not logged in.');
  } else {
    client.logout();
    console.log('Logged out.');
  }

  client.destroy();
}
