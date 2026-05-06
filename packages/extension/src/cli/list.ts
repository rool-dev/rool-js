/**
 * rool-extension list
 *
 * Lists the extensions in the current user's library.
 */

import type { Environment } from '../manifest.js';
import { getClient } from './client.js';
import { formatBytes } from './vite-utils.js';

export async function list(env: Environment): Promise<void> {
  const client = await getClient(env);
  try {
    const extensions = await client.listExtensions();

    if (extensions.length === 0) {
      console.log('No extensions.');
      return;
    }

    console.log('Your extensions:');
    console.log('');
    for (const a of extensions) {
      console.log(`  ${a.extensionId}`);
      console.log(`    Name: ${a.manifest.name}`);
      console.log(`    URL: ${a.url}`);
      console.log(`    Size: ${formatBytes(a.sizeBytes)}`);
      console.log(`    Updated: ${new Date(a.updatedAt).toLocaleString()}`);
      console.log('');
    }
  } finally {
    client.destroy();
  }
}
