#!/usr/bin/env node
export {};

const command = process.argv[2];

switch (command) {
  case 'dev': {
    const { dev } = await import('./dev.js');
    await dev();
    break;
  }
  case 'init': {
    const { init } = await import('./init.js');
    init();
    break;
  }
  case 'build': {
    const { build } = await import('./build.js');
    await build();
    break;
  }
  case 'publish': {
    const { publish } = await import('./publish.js');
    await publish();
    break;
  }
  default:
    console.log(`Usage: rool-app <command>

Commands:
  init      Create a new app project
  dev       Start the dev server
  build     Build the app
  publish   Build and publish the app`);
    process.exit(command ? 1 : 0);
}
