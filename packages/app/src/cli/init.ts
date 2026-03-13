/**
 * rool-app init [name]
 *
 * Scaffolds a new app project in the current directory or a named subdirectory.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function init() {
  const name = process.argv[3];
  const dir = name ? resolve(process.cwd(), name) : process.cwd();
  const appName = name ?? basename(dir);
  const appId = toId(appName);

  if (name) {
    if (existsSync(dir)) {
      console.error(`Directory "${name}" already exists.`);
      process.exit(1);
    }
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(resolve(dir, 'rool-app.json'))) {
    console.error('rool-app.json already exists in this directory.');
    process.exit(1);
  }

  // Resolve the path to @rool-dev/app for a local link
  const appPkgDir = resolve(__dirname, '../..');
  const manifest = {
    id: appId,
    name: appName,
  };

  const appSvelte = `<script lang="ts">
  import type { ReactiveAppChannel } from '@rool-dev/app';

  interface Props {
    channel: ReactiveAppChannel;
  }

  let { channel }: Props = $props();
</script>

<div class="h-full flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-2xl font-bold text-slate-800 mb-2">${appName}</h1>
    <p class="text-slate-500">Edit App.svelte to get started</p>
  </div>
</div>
`;

  const packageJson = {
    name: appId,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'rool-app dev',
    },
    dependencies: {
      '@rool-dev/app': `link:${appPkgDir}`,
    },
    devDependencies: {
      svelte: '^5.0.0',
      typescript: '^5.0.0',
    },
  };

  const agentsMd = `# ${appName}

This is a Rool App — a sandboxed Svelte 5 component that runs inside a Rool Space.

## Documentation

Read the app SDK documentation before making changes:

\`\`\`
cat node_modules/@rool-dev/app/README.md
\`\`\`

## Project structure

- \`App.svelte\` — Main component (receives \`channel: ReactiveAppChannel\` as a prop)
- \`rool-app.json\` — Manifest (id, name, collections)
- \`app.css\` — Optional custom styles (Tailwind v4 is available by default)

Additional \`.svelte\` and \`.ts\` files can be imported from \`App.svelte\`.

## Dev server

\`\`\`
npx rool-app dev
\`\`\`
`;

  writeFileSync(resolve(dir, 'rool-app.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(resolve(dir, 'App.svelte'), appSvelte);
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  writeFileSync(resolve(dir, 'AGENTS.md'), agentsMd);

  const relDir = name ?? '.';
  console.log(`
  Created app "${appName}" in ${relDir}/

  Next steps:
    ${name ? `cd ${name}` : ''}
    npm install
    npx rool-app dev
`);
}

init();
