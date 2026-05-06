/**
 * Shared SDK client setup for rool-extension subcommands that hit the
 * Rool platform (list, delete, publish-public, unpublish, upload).
 */

import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import type { Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';

const APP_NAME = 'Rool Extension CLI';

export function parseEnv(args: string[]): Environment {
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
  return env;
}

export async function getClient(env: Environment): Promise<RoolClient> {
  const envConfig = ENV_URLS[env];
  const client = new RoolClient({
    apiUrl: envConfig.apiUrl,
    authUrl: envConfig.authUrl,
    authProvider: new NodeAuthProvider(),
  });

  if (!await client.isAuthenticated()) {
    console.log('Opening browser to authenticate...');
    await client.login(APP_NAME);
  }

  return client;
}
