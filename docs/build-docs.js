#!/usr/bin/env node
/**
 * Copies package READMEs to docs folder with necessary transformations.
 * Run before astro build/dev.
 *
 * Static pages (index.md, console.md) are checked into git directly.
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

// SDK README → sdk.md (will be at /sdk/)
const sdkReadme = readFileSync(`${root}/packages/sdk/README.md`, 'utf-8');
writeFileSync(`${contentDir}/sdk.md`, transform(sdkReadme, 'Rool SDK'));

// CLI README → cli.md (will be at /cli/)
const cliReadme = readFileSync(`${root}/packages/cli/README.md`, 'utf-8');
writeFileSync(`${contentDir}/cli.md`, transform(cliReadme, 'Rool CLI'));

// Svelte README → svelte.md (will be at /svelte/)
const svelteReadme = readFileSync(`${root}/packages/svelte/README.md`, 'utf-8');
writeFileSync(`${contentDir}/svelte.md`, transform(svelteReadme, 'Rool Svelte'));

// Generate llms.txt from index.md (strip frontmatter, fix relative links)
const indexMd = readFileSync(`${contentDir}/index.md`, 'utf-8');
const llmsTxt = indexMd
  .replace(/^---[\s\S]*?---\n+/, '# Rool\n\n') // Replace frontmatter with title
  .replace(/\]\(\//g, '](https://docs.rool.dev/'); // Make relative links absolute
writeFileSync(`${__dirname}/public/llms.txt`, llmsTxt);

console.log('Docs built from READMEs');
