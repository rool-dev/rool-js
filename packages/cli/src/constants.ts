import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
export const DEFAULT_SPACE_NAME = 'Rool CLI';
export const DEFAULT_CHANNEL_ID = 'rool-dev';

export type Environment = 'local' | 'dev' | 'prod';
export const DEFAULT_ENV: Environment = 'prod';

const ENVIRONMENTS: Record<Environment, { domain: string; baseUrl?: string }> = {
  local: { domain: 'dev.rool.dev', baseUrl: 'http://localhost:1357' },
  dev: { domain: 'dev.rool.dev' },
  prod: { domain: 'rool.dev' },
};

export function getEnvConfig(env: Environment): { domain: string; baseUrl?: string } {
  return ENVIRONMENTS[env];
}
