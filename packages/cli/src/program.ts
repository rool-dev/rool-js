import { Command } from 'commander';
import { VERSION } from './constants.js';
import { registerChat } from './chat.js';
import { registerMedia } from './media.js';
import { registerSpace } from './space.js';
import { registerPublish } from './publish.js';
import { registerUser } from './user.js';
import { registerLogout } from './logout.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('rool')
    .version(VERSION)
    .description('Command-line interface for the Rool platform');

  registerChat(program);
  registerMedia(program);
  registerSpace(program);
  registerPublish(program);
  registerUser(program);
  registerLogout(program);

  return program;
}
