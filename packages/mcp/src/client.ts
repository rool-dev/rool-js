// =============================================================================
// Rool Client Pool
// Manages RoolClient instances per environment for the MCP server.
// Reuses credentials from ~/.config/rool/ (shared with the Rool CLI).
// =============================================================================

import { RoolClient } from '@rool-dev/sdk';
import { NodeAuthProvider } from '@rool-dev/sdk/node';

export type Environment = 'local' | 'dev' | 'prod';

export const ENV_URLS: Record<Environment, { baseUrl: string; authUrl: string }> = {
  local: { baseUrl: 'http://localhost:1357', authUrl: 'https://api.dev.rool.dev/auth' },
  dev: { baseUrl: 'https://api.dev.rool.dev', authUrl: 'https://api.dev.rool.dev/auth' },
  prod: { baseUrl: 'https://api.rool.dev', authUrl: 'https://api.rool.dev/auth' },
};

const VALID_ENVS = new Set<string>(Object.keys(ENV_URLS));

/**
 * Resolve the default environment from ROOL_ENV (fallback: 'dev').
 */
export function getDefaultEnv(): Environment {
  const env = process.env.ROOL_ENV;
  if (env && VALID_ENVS.has(env)) return env as Environment;
  return 'dev';
}

// =============================================================================
// Client Pool — one client per environment
// =============================================================================

const clients = new Map<string, RoolClient>();

/**
 * Resolve the API URLs for a given environment.
 *
 * Priority:
 *  1. ROOL_API_URL — custom base URL (auth URL derived as <baseUrl>/auth).
 *     When set, the environment parameter is ignored.
 *  2. Explicit environment parameter (local, dev, prod).
 *  3. ROOL_ENV fallback, then 'dev'.
 */
function resolveUrls(env?: Environment): { key: string; baseUrl: string; authUrl: string } {
  const customUrl = process.env.ROOL_API_URL;
  if (customUrl) {
    const baseUrl = customUrl.replace(/\/+$/, '');
    return { key: baseUrl, baseUrl, authUrl: `${baseUrl}/auth` };
  }

  const resolved = env ?? getDefaultEnv();
  const urls = ENV_URLS[resolved];
  return { key: resolved, ...urls };
}

/**
 * Get or create a RoolClient for the given environment.
 * Clients are cached and reused across tool calls.
 * If not authenticated, triggers browser-based login automatically.
 */
export async function getClient(env?: Environment): Promise<RoolClient> {
  const { key, baseUrl, authUrl } = resolveUrls(env);

  const cached = clients.get(key);
  if (cached) return cached;

  const authProvider = new NodeAuthProvider({
    credentialsPath: process.env.ROOL_CREDENTIALS_PATH || undefined,
  });

  const newClient = new RoolClient({
    baseUrl,
    authUrl,
    authProvider,
  });

  if (!await newClient.isAuthenticated()) {
    await newClient.login('Rool MCP');
  }

  clients.set(key, newClient);
  return newClient;
}

/**
 * Destroy all cached clients. Called on server shutdown.
 */
export function destroyAllClients(): void {
  for (const c of clients.values()) {
    c.destroy();
  }
  clients.clear();
}
