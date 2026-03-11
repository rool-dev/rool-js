// =============================================================================
// Rool Client Singleton
// Manages a single RoolClient instance with NodeAuthProvider for the MCP server.
// Reuses credentials from ~/.config/rool/ (shared with the Rool CLI).
// =============================================================================

import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';

type Environment = 'local' | 'dev' | 'prod';

const ENV_URLS: Record<Environment, { baseUrl: string; authUrl: string }> = {
  local: { baseUrl: 'http://localhost:1357', authUrl: 'https://api.dev.rool.dev/auth' },
  dev: { baseUrl: 'https://api.dev.rool.dev', authUrl: 'https://api.dev.rool.dev/auth' },
  prod: { baseUrl: 'https://api.rool.dev', authUrl: 'https://api.rool.dev/auth' },
};

let client: RoolClient | null = null;
let clientKey: string | null = null;

/**
 * Resolve the API URLs from environment variables.
 *
 * Priority:
 *  1. ROOL_API_URL — custom base URL (auth URL derived as <baseUrl>/auth)
 *  2. ROOL_ENV — preset environment: local, dev, prod (default: prod)
 */
function resolveUrls(): { baseUrl: string; authUrl: string } {
  const customUrl = process.env.ROOL_API_URL;
  if (customUrl) {
    const baseUrl = customUrl.replace(/\/+$/, '');
    return { baseUrl, authUrl: `${baseUrl}/auth` };
  }

  const env = process.env.ROOL_ENV as Environment | undefined;
  if (env && env in ENV_URLS) return ENV_URLS[env];
  return ENV_URLS.prod;
}

/**
 * Get or create the singleton RoolClient.
 * On first call, creates the client and checks authentication.
 * If not authenticated, triggers browser-based login.
 */
export async function getClient(): Promise<RoolClient> {
  const urls = resolveUrls();
  const key = urls.baseUrl;

  if (client && clientKey === key) {
    return client;
  }

  // Destroy previous client if configuration changed
  if (client) {
    client.destroy();
    client = null;
  }

  const authProvider = new NodeAuthProvider({
    credentialsPath: process.env.ROOL_CREDENTIALS_PATH || undefined,
  });

  const newClient = new RoolClient({
    baseUrl: urls.baseUrl,
    authUrl: urls.authUrl,
    authProvider,
  });

  if (!await newClient.isAuthenticated()) {
    // Attempt browser login — this will open the browser and wait for auth
    await newClient.login('Rool MCP');
  }

  client = newClient;
  clientKey = key;
  return client;
}

/**
 * Destroy the singleton client. Called on server shutdown.
 */
export function destroyClient(): void {
  if (client) {
    client.destroy();
    client = null;
    clientKey = null;
  }
}
