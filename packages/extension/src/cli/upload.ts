/**
 * rool-extension upload
 *
 * Builds the extension with Vite and uploads it to your library on the
 * Rool extension platform. With --publish, also publishes it to the public
 * marketplace.
 *
 * Usage: rool-extension upload [--env local|dev|prod] [--publish]
 */

import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import type { Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';
import { readManifestOrExit, formatBytes } from './vite-utils.js';
import { buildExtension, zipProject } from './build-pipeline.js';

export async function upload(opts: { env: Environment; publish: boolean }) {
  const cwd = process.cwd();
  const { env, publish } = opts;
  const manifest = readManifestOrExit(cwd);

  console.log(`\n  Building ${manifest.name}...\n`);
  const { totalSize } = await buildExtension(cwd, manifest);
  const zipBuffer = await zipProject(cwd);
  console.log(`\n  Build complete — ${formatBytes(totalSize)}`);
  console.log(`  Bundle: ${formatBytes(zipBuffer.length)}\n`);

  const envConfig = ENV_URLS[env];
  const client = new RoolClient({
    apiUrl: envConfig.apiUrl,
    authUrl: envConfig.authUrl,
    authProvider: new NodeAuthProvider(),
  });

  if (!await client.isAuthenticated()) {
    console.log('  Opening browser to authenticate...');
    await client.login('Rool Extension CLI');
  }

  console.log(`  Uploading ${manifest.id} to ${env}...`);
  const blob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
  const result = await client.uploadExtension(manifest.id, {
    bundle: blob,
  });

  console.log(`\n  Uploaded: ${result.manifest.name}`);
  console.log(`  URL: ${result.url}`);
  console.log(`  Size: ${formatBytes(result.sizeBytes)}`);

  if (publish) {
    console.log(`\n  Publishing ${manifest.id} to the public marketplace...`);
    await client.publishToPublic(manifest.id);
    console.log(`  Published.\n`);
  } else {
    console.log('');
  }

  client.destroy();
}
