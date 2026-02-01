#!/usr/bin/env node
/**
 * Copies READMEs to docs folder with necessary transformations.
 * Run before astro build/dev.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const contentDir = `${__dirname}/src/content/docs`;

// Ensure content directory exists
mkdirSync(contentDir, { recursive: true });

function transform(content, title) {
  // Fix LICENSE links (make them external GitHub links)
  content = content.replace(
    /\[LICENSE\]\(\.\.\/\.\.\/LICENSE\)/g,
    '[LICENSE](https://github.com/rool-dev/rool-js/blob/main/LICENSE)'
  );

  // Remove the first H1 (Starlight adds title from frontmatter)
  content = content.replace(/^# .+\n+/, '');

  // Add frontmatter for Starlight
  const frontmatter = `---
title: ${title}
---

`;

  return frontmatter + content;
}

// SDK README → index.md (will be at /)
const sdkReadme = readFileSync(`${root}/packages/sdk/README.md`, 'utf-8');
writeFileSync(`${contentDir}/index.md`, transform(sdkReadme, 'Rool SDK'));

// CLI README → cli.md (will be at /cli/)
const cliReadme = readFileSync(`${root}/packages/cli/README.md`, 'utf-8');
writeFileSync(`${contentDir}/cli.md`, transform(cliReadme, 'Rool CLI'));

console.log('Docs built from READMEs');
