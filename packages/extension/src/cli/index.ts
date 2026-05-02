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
  case 'upload': {
    const { upload } = await import('./upload.js');
    await upload();
    break;
  }
  default:
    console.log(`Usage: rool-extension <command>

Commands:
  init      Create a new extension project
  dev       Start the dev server
  build     Build the extension
  upload    Build and upload the extension to your library (--publish to also publish)`);
    process.exit(command ? 1 : 0);
}
