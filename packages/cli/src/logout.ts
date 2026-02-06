import { parseArgs } from './args.js';
import { getClient } from './client.js';

export async function logout(args: string[]): Promise<void> {
  const { url: apiUrl, rest } = parseArgs(args);

  if (rest.length > 0) {
    console.error('Usage: rool logout [options]');
    console.error('');
    console.error('Options:');
    console.error('  -u, --url <url>    API URL (default: https://api.rool.dev)');
    process.exit(1);
  }

  const client = await getClient(apiUrl, { autoLogin: false });
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
}
