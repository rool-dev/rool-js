/**
 * rool-extension upload
 *
 * Builds the extension with Vite and uploads it to your library on the
 * Rool extension platform. With --publish, also publishes it to the public
 * marketplace.
 *
 * Usage: npx rool-extension upload [--env local|dev|prod] [--publish]
 */

import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import type { Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';
import { readManifestOrExit, formatBytes } from './vite-utils.js';
import { buildExtension, zipProject } from './build-pipeline.js';

function parseArgs(): { env: Environment; publish: boolean } {
  const args = process.argv.slice(3); // after 'upload'
  let env: Environment = 'prod';
  let publish = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) {
      const val = args[i + 1];
      if (val !== 'local' && val !== 'dev' && val !== 'prod') {
        console.error(`Invalid environment: ${val}. Use 'local', 'dev', or 'prod'.`);
        process.exit(1);
      }
      env = val;
      i++;
    } else if (args[i] === '--publish' || args[i] === '-p') {
      publish = true;
    }
  }

  return { env, publish };
}

export async function upload() {
  const cwd = process.cwd();
  const { env, publish } = parseArgs();
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
