import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';

export function registerCreate(program: Command): void {
  program
    .command('create [name]')
    .description('Create a new Rool app')
    .action((name?: string) => {
      // Resolve the rool-app binary from @rool-dev/app
      const require = createRequire(import.meta.url);
      const appPkg = require.resolve('@rool-dev/app/package.json');
      const bin = resolve(dirname(appPkg), 'dist/cli/index.js');

      const args = ['init', ...(name ? [name] : [])];
      const result = spawnSync(process.execPath, [bin, ...args], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      process.exit(result.status ?? 1);
    });
}
