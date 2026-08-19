#!/usr/bin/env node
/**
 * Copies the package README to the docs folder with necessary transformations.
 * Run before astro build/dev.
 *
 * Static pages (index.md) are checked into git directly.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const contentDir = `${__dirname}/src/content/docs`;
const sdkAssetsDir = `${__dirname}/public/sdk-assets`;

// Ensure generated docs and their SDK assets are current.
mkdirSync(contentDir, { recursive: true });
rmSync(sdkAssetsDir, { recursive: true, force: true });
cpSync(`${root}/assets`, sdkAssetsDir, { recursive: true });

function getVersion() {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf-8"));
  return pkg.version;
}

function transform(content, title) {
  // Fix repository-relative links for the published docs.
  content = content
    .replace(
      /\[LICENSE\]\(\.\/LICENSE\)/g,
      "[LICENSE](https://github.com/rool-dev/rool-js/blob/main/LICENSE)",
    )
    .replace(/\.\/assets\//g, "/sdk-assets/");

  // Remove the first H1 (Starlight adds title from frontmatter)
  content = content.replace(/^# .+\n+/, "");

  // Add frontmatter for Starlight
  const version = getVersion();
  const frontmatter = `---
title: ${title}
---

<p><code>v${version}</code></p>

`;

  return frontmatter + content;
}

// SDK README → sdk.md (will be at /sdk/)
const sdkReadme = readFileSync(`${root}/README.md`, "utf-8");
writeFileSync(`${contentDir}/sdk.md`, transform(sdkReadme, "Rool SDK"));

// Generate llms.txt from index.md (strip frontmatter, fix relative links)
const indexMd = readFileSync(`${contentDir}/index.md`, "utf-8");
const llmsTxt = indexMd
  .replace(/^---[\s\S]*?---\n+/, "# Rool\n\n") // Replace frontmatter with title
  .replace(/\]\(\//g, "](https://docs.rool.dev/"); // Make relative links absolute
writeFileSync(`${__dirname}/public/llms.txt`, llmsTxt);

console.log("Docs built from README");
