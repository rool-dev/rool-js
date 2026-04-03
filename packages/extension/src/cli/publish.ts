/**
 * rool-extension publish
 *
 * Builds the extension with Vite and publishes it to the Rool extension platform.
 *
 * Usage: npx rool-extension publish [--env local|dev|prod]
 */

import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import type { Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';
import { readManifestOrExit, formatBytes } from './vite-utils.js';
import { buildExtension, zipProject } from './build-pipeline.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { env: Environment } {
  const args = process.argv.slice(3); // after 'publish'
  let env: Environment = 'prod';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) {
      const val = args[i + 1];
      if (val !== 'local' && val !== 'dev' && val !== 'prod') {
        console.error(`Invalid environment: ${val}. Use 'local', 'dev', or 'prod'.`);
        process.exit(1);
      }
      env = val;
      i++;
    }
  }

  return { env };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function publish() {
  const cwd = process.cwd();
  const { env } = parseArgs();
  const manifest = readManifestOrExit(cwd);

  console.log(`\n  Building ${manifest.name}...\n`);
  const { totalSize } = await buildExtension(cwd, manifest);
  const zipBuffer = await zipProject(cwd);
  console.log(`\n  Build complete — ${formatBytes(totalSize)}`);
  console.log(`  Bundle: ${formatBytes(zipBuffer.length)}\n`);

  // Authenticate
  const urls = ENV_URLS[env];
  const client = new RoolClient({
    baseUrl: urls.baseUrl,
    authUrl: urls.authUrl,
    authProvider: new NodeAuthProvider(),
  });

  if (!await client.isAuthenticated()) {
    console.log('  Opening browser to authenticate...');
    await client.login('Rool Extension CLI');
  }

  // Publish
  console.log(`  Publishing ${manifest.id} to ${env}...`);
  const blob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
  const result = await client.uploadExtension(manifest.id, {
    bundle: blob,
  });

  console.log(`\n  Published: ${result.manifest.name}`);
  console.log(`  URL: ${result.url}`);
  console.log(`  Size: ${formatBytes(result.sizeBytes)}\n`);

  client.destroy();
}
