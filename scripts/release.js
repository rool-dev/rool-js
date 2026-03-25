#!/usr/bin/env node

/**
 * Release all packages with a unified version.
 * Bumps all package.json files, commits, and tags.
 *
 * Usage:
 *   pnpm release 0.2.0
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const packages = [
  'packages/sdk/package.json',
  'packages/cli/package.json',
  'packages/svelte/package.json',
  'packages/app/package.json',
];

const version = process.argv[2];

function suggestVersions(latest) {
  if (!latest) return '';
  const { major, minor, patch } = latest;
  return `  Next patch: ${major}.${minor}.${patch + 1}\n  Next minor: ${major}.${minor + 1}.0\n  Next major: ${major + 1}.0.0`;
}

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  const latest = getLatestVersion();
  if (!version) {
    console.error('Usage: pnpm release <version>');
  } else {
    console.error(`Invalid version: ${version}`);
  }
  if (latest) {
    console.error(`\nCurrent version: ${latest.tag.slice(1)}\n${suggestVersions(latest)}`);
  }
  process.exit(1);
}

const tag = `v${version}`;
const [major, minor, patch] = version.split('-')[0].split('.').map(Number);

// Find the latest existing version tag
function getLatestVersion() {
  try {
    const tags = execSync('git tag --list "v*" --sort=-version:refname', { cwd: root, encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(t => /^v\d+\.\d+\.\d+$/.test(t));
    if (tags.length === 0) return null;
    const parts = tags[0].slice(1).split('.').map(Number);
    return { major: parts[0], minor: parts[1], patch: parts[2], tag: tags[0] };
  } catch {
    return null;
  }
}

const latest = getLatestVersion();

if (latest) {
  // Must be strictly greater
  const newVal = major * 1e6 + minor * 1e3 + patch;
  const latestVal = latest.major * 1e6 + latest.minor * 1e3 + latest.patch;
  if (newVal <= latestVal) {
    console.error(`Error: Version ${version} is not greater than latest release ${latest.tag.slice(1)}`);
    process.exit(1);
  }

  // Check for holes in the least significant changed position
  if (major === latest.major && minor === latest.minor) {
    // Patch bump — must increment by exactly 1
    if (patch !== latest.patch + 1) {
      console.error(`Error: Patch version gap — expected ${latest.major}.${latest.minor}.${latest.patch + 1}, got ${version}`);
      process.exit(1);
    }
  } else if (major === latest.major) {
    // Minor bump — minor must increment by exactly 1, patch must be 0
    if (minor !== latest.minor + 1) {
      console.error(`Error: Minor version gap — expected ${latest.major}.${latest.minor + 1}.0, got ${version}`);
      process.exit(1);
    }
    if (patch !== 0) {
      console.error(`Error: Patch should be 0 when bumping minor — expected ${major}.${minor}.0, got ${version}`);
      process.exit(1);
    }
  } else {
    // Major bump — major must increment by exactly 1, minor and patch must be 0
    if (major !== latest.major + 1) {
      console.error(`Error: Major version gap — expected ${latest.major + 1}.0.0, got ${version}`);
      process.exit(1);
    }
    if (minor !== 0 || patch !== 0) {
      console.error(`Error: Minor and patch should be 0 when bumping major — expected ${major}.0.0, got ${version}`);
      process.exit(1);
    }
  }
}

// Check for uncommitted changes
try {
  const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim();
  if (status) {
    console.error('Error: Working directory has uncommitted changes. Commit or stash them first.');
    process.exit(1);
  }
} catch {
  console.error('Error: Failed to check git status');
  process.exit(1);
}

// Check tag doesn't already exist
try {
  execSync(`git rev-parse ${tag}`, { cwd: root, stdio: 'ignore' });
  console.error(`Error: Tag ${tag} already exists`);
  process.exit(1);
} catch {
  // Tag doesn't exist, good
}

// Bump versions in package.json files
for (const pkgPath of packages) {
  const fullPath = join(root, pkgPath);
  const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const oldVersion = pkg.version;
  pkg.version = version;
  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}: ${oldVersion} → ${version}`);
}

// Commit and tag
const filesToAdd = packages.join(' ');
execSync(`git add ${filesToAdd}`, { cwd: root, stdio: 'inherit' });
execSync(`git commit -m "${tag}"`, { cwd: root, stdio: 'inherit' });
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' });

console.log(`\nDone. Push to publish:\n`);
console.log(`  git push origin main --tags`);
