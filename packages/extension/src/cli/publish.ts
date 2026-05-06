/**
 * rool-extension publish-public <extension-id>
 * rool-extension unpublish      <extension-id>
 *
 * Toggles whether an already-uploaded extension appears in the public
 * marketplace.
 */

import type { Environment } from '../manifest.js';
import { getClient } from './client.js';

export async function publishPublic(rawExtensionId: string, env: Environment): Promise<void> {
  const extensionId = rawExtensionId.toLowerCase();
  const client = await getClient(env);
  try {
    await client.publishToPublic(extensionId);
    console.log(`Published to public catalog: ${extensionId}`);
  } finally {
    client.destroy();
  }
}

export async function unpublish(rawExtensionId: string, env: Environment): Promise<void> {
  const extensionId = rawExtensionId.toLowerCase();
  const client = await getClient(env);
  try {
    await client.unpublishFromPublic(extensionId);
    console.log(`Unpublished from public catalog: ${extensionId}`);
  } finally {
    client.destroy();
  }
}
