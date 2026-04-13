import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
export const DEFAULT_SPACE_NAME = 'Rool CLI';
export const DEFAULT_CHANNEL_ID = 'rool-dev';

export type Environment = 'local' | 'dev' | 'prod';
export const DEFAULT_ENV: Environment = 'prod';

const ENVIRONMENTS: Record<Environment, { apiUrl: string; authUrl?: string }> = {
  local: { apiUrl: 'http://localhost:1357', authUrl: 'https://dev.rool.dev/auth' },
  dev: { apiUrl: 'https://api.dev.rool.dev' },
  prod: { apiUrl: 'https://api.rool.dev' },
};

export function getEnvConfig(env: Environment): { apiUrl: string; authUrl?: string } {
  return ENVIRONMENTS[env];
}
