import { parseArgs } from './args.js';
import { getClient } from './client.js';

export async function user(args: string[]): Promise<void> {
  const { url: apiUrl, rest } = parseArgs(args);

  if (rest.length > 0) {
    console.error('Usage: rool user [options]');
    console.error('');
    console.error('Options:');
    console.error('  -u, --url <url>    API URL (default: https://api.rool.dev)');
    process.exit(1);
  }

  const client = await getClient(apiUrl, { autoLogin: false });
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
}
