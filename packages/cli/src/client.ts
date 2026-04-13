import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';
import { type Environment, getEnvConfig } from './constants.js';

const APP_NAME = 'Rool CLI';

export async function getClient(
  env: Environment,
  options?: { autoLogin?: boolean },
): Promise<RoolClient> {
  const authProvider = new NodeAuthProvider();
  const envConfig = getEnvConfig(env);
  const client = new RoolClient({ ...envConfig, authProvider });

  if (!await client.isAuthenticated()) {
    if (options?.autoLogin === false) {
      return client;
    }
    console.log('Opening browser to authenticate...');
    await client.login(APP_NAME);
  }

  return client;
}
