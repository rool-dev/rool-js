/**
 * rool-extension delete <extension-id>
 *
 * Permanently deletes an extension from the user's library.
 */

import type { Environment } from '../manifest.js';
import { getClient } from './client.js';

export async function deleteExtension(rawExtensionId: string, env: Environment): Promise<void> {
  const extensionId = rawExtensionId.toLowerCase();
  const client = await getClient(env);
  try {
    const info = await client.getExtensionInfo(extensionId);
    if (!info) {
      console.error(`Extension not found: ${extensionId}`);
      process.exit(1);
    }

    await client.deleteExtension(extensionId);
    console.log(`Deleted: ${extensionId}`);
  } finally {
    client.destroy();
  }
}
