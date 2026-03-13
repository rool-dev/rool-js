#!/usr/bin/env node
export {};

const command = process.argv[2];

switch (command) {
  case 'dev':
    await import('./dev.js');
    break;
  case 'init':
    await import('./init.js');
    break;
  default:
    console.log(`Usage: rool-app <command>

Commands:
  init   Create a new app project
  dev    Start the dev server`);
    process.exit(command ? 1 : 0);
}
