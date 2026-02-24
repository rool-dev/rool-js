import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
export const DEFAULT_SPACE_NAME = 'Rool CLI';
export const DEFAULT_CONVERSATION_ID = 'rool-dev';

export type Environment = 'local' | 'dev' | 'prod';
export const DEFAULT_ENV: Environment = 'prod';

const ENV_URLS: Record<Environment, { target: string; auth: string }> = {
  local: { target: 'http://localhost:1357', auth: 'https://api.dev.rool.dev/auth' },
  dev: { target: 'https://api.dev.rool.dev', auth: 'https://api.dev.rool.dev/auth' },
  prod: { target: 'https://api.rool.dev', auth: 'https://api.rool.dev/auth' },
};

export function getApiUrls(env: Environment): { baseUrl: string; authUrl: string } {
  const urls = ENV_URLS[env];
  return { baseUrl: urls.target, authUrl: urls.auth };
}
