import { Command } from 'commander';
import { VERSION, DEFAULT_ENV, type Environment } from './constants.js';
import { registerChat } from './chat.js';
import { registerCreate } from './create.js';
import { registerMedia } from './media.js';
import { registerSpace } from './space.js';
import { registerApp } from './app.js';
import { registerUser } from './user.js';
import { registerLogout } from './logout.js';

function validateEnv(value: string): Environment {
  if (value !== 'local' && value !== 'dev' && value !== 'prod') {
    throw new Error(`Invalid environment: ${value}. Must be local, dev, or prod.`);
  }
  return value;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('rool')
    .version(VERSION)
    .description('Command-line interface for the Rool platform')
    .option('-e, --env <environment>', 'target environment (local, dev, prod)', validateEnv, DEFAULT_ENV);

  registerChat(program);
  registerCreate(program);
  registerMedia(program);
  registerSpace(program);
  registerApp(program);
  registerUser(program);
  registerLogout(program);

  return program;
}
