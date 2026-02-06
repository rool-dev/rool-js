import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';

const APP_NAME = 'Rool CLI';

export async function getClient(
  apiUrl: string,
  options?: { autoLogin?: boolean },
): Promise<RoolClient> {
  const authProvider = new NodeAuthProvider();
  const client = new RoolClient({ baseUrl: apiUrl, authProvider });

  if (!await client.isAuthenticated()) {
    if (options?.autoLogin === false) {
      return client;
    }
    console.log('Opening browser to authenticate...');
    await client.login(APP_NAME);
  }

  return client;
}
