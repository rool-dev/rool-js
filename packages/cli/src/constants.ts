import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
export const DEFAULT_API_URL = 'https://api.rool.dev';
export const DEFAULT_SPACE_NAME = 'Rool CLI';
export const DEFAULT_CONVERSATION_ID = 'rool-dev';
