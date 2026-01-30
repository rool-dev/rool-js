#!/usr/bin/env npx tsx
/**
 * Cleanup orphaned media files from GCS bucket.
 *
 * Compares space prefixes in the media bucket against the database
 * (via adminListSpaces GraphQL API) and deletes any prefixes that
 * don't have a corresponding space record.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphaned-media.ts <env>                      # Dry run (list orphans)
 *   npx tsx scripts/cleanup-orphaned-media.ts <env> --execute            # Actually delete
 *   npx tsx scripts/cleanup-orphaned-media.ts <env> --min-age 48         # Skip files newer than 48h
 *
 * Options:
 *   --execute       Actually delete orphaned files (default: dry run)
 *   --min-age <h>   Minimum age in hours before deletion (default: 24)
 *
 * Environments:
 *   dev, development  -> rool-deploy-development (api.dev.rool.dev)
 *   alpha             -> rool-deploy-alpha (api.rool.dev)
 *
 * Prerequisites:
 *   - gcloud CLI authenticated with appropriate permissions
 *   - Your rool account must have admin plan in the target environment
 */

import { execSync } from "node:child_process";
import * as readline from "node:readline";
import { RoolClient } from "../src/client.js";
import { NodeAuthProvider } from "../src/auth-node.js";

// Colors for output
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const NC = "\x1b[0m"; // No Color

interface EnvConfig {
  projectId: string;
  apiDomain: string;
}

const ENVIRONMENTS: Record<string, EnvConfig> = {
  dev: { projectId: "rool-deploy-development", apiDomain: "api.dev.rool.dev" },
  development: { projectId: "rool-deploy-development", apiDomain: "api.dev.rool.dev" },
  alpha: { projectId: "rool-deploy-alpha", apiDomain: "api.rool.dev" },
};

function printUsage(): void {
  console.log("Usage: npx tsx scripts/cleanup-orphaned-media.ts <env> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --execute         Actually delete orphaned files (default: dry run)");
  console.log("  --min-age <hours> Minimum age in hours before deletion (default: 24)");
  console.log("");
  console.log("Environments:");
  console.log("  dev, development  -> rool-deploy-development");
  console.log("  alpha             -> rool-deploy-alpha");
  console.log("");
  console.log("Examples:");
  console.log("  npx tsx scripts/cleanup-orphaned-media.ts dev                # Dry run");
  console.log("  npx tsx scripts/cleanup-orphaned-media.ts dev --execute      # Actually delete");
  console.log("  npx tsx scripts/cleanup-orphaned-media.ts dev --min-age 48   # 48h minimum age");
  console.log("");
  console.log("Prerequisites:");
  console.log("  - gcloud CLI authenticated");
  console.log("  - Your rool account must have admin plan");
  process.exit(1);
}

function getNewestFileTime(bucket: string, prefix: string): Date | null {
  try {
    // gcloud storage ls -l returns lines like:
    // 12345  2024-01-15T10:30:00Z  gs://bucket/prefix/file.jpg
    const output = exec(`gcloud storage ls -l "gs://${bucket}/${prefix}/"`);
    const lines = output.split("\n").filter((line) => line.trim().length > 0);

    let newestTime: Date | null = null;
    for (const line of lines) {
      // Parse the timestamp from the second column
      const match = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
      if (match) {
        const time = new Date(match[0]);
        if (!newestTime || time > newestTime) {
          newestTime = time;
        }
      }
    }
    return newestTime;
  } catch {
    return null;
  }
}

function exec(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error(`Command failed: ${command}`);
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const envName = args[0];
  const execute = args.includes("--execute");

  // Parse --min-age flag (default 24 hours)
  let minAgeHours = 24;
  const minAgeIndex = args.indexOf("--min-age");
  if (minAgeIndex !== -1 && args[minAgeIndex + 1]) {
    minAgeHours = parseInt(args[minAgeIndex + 1], 10);
    if (isNaN(minAgeHours) || minAgeHours < 0) {
      console.error(`${RED}Invalid --min-age value${NC}`);
      printUsage();
      return;
    }
  }

  if (!envName || !ENVIRONMENTS[envName]) {
    printUsage();
    return;
  }

  const config = ENVIRONMENTS[envName];
  const bucket = `${config.projectId}-media`;
  const minAgeMs = minAgeHours * 60 * 60 * 1000;
  const cutoffTime = new Date(Date.now() - minAgeMs);

  console.log(`${YELLOW}=== Orphaned Media Cleanup ===${NC}`);
  console.log(`Environment: ${envName}`);
  console.log(`Project:     ${config.projectId}`);
  console.log(`Bucket:      gs://${bucket}`);
  console.log(`API:         https://${config.apiDomain}`);
  console.log(`Min age:     ${minAgeHours} hours (files newer than ${cutoffTime.toISOString()} skipped)`);
  console.log(`Mode:        ${execute ? `${RED}EXECUTE (will delete!)${NC}` : `${GREEN}DRY RUN${NC}`}`);
  console.log("");

  // Step 1: Authenticate and fetch space IDs from API
  console.log(`${YELLOW}Step 1: Fetching space IDs from API...${NC}`);
  console.log("");

  const client = new RoolClient({
    baseUrl: `https://${config.apiDomain}`,
    authProvider: new NodeAuthProvider(),
  });

  client.initialize();

  if (!(await client.isAuthenticated())) {
    console.log("Not authenticated. Opening browser for login...");
    await client.login();
    console.log("Login complete.\n");
  }

  const result = await client.graphql<{
    adminListSpaces: Array<{ id: string }>;
  }>(`
    query {
      adminListSpaces {
        id
      }
    }
  `);

  const validSpaces = new Set(result.adminListSpaces.map((s) => s.id));
  console.log(`Found ${GREEN}${validSpaces.size}${NC} spaces in database`);
  console.log("");

  client.destroy();

  // Step 2: Get space prefixes from bucket
  console.log(`${YELLOW}Step 2: Listing bucket prefixes...${NC}`);

  let bucketPrefixes: string[];
  try {
    const output = exec(`gcloud storage ls "gs://${bucket}/"`);
    bucketPrefixes = output
      .split("\n")
      .map((line) => line.replace(`gs://${bucket}/`, "").replace(/\/$/, ""))
      .filter((prefix) => prefix.length > 0);
  } catch (error) {
    console.error(`${RED}Failed to list bucket. Check if bucket exists and you have access.${NC}`);
    process.exit(1);
  }

  console.log(`Found ${GREEN}${bucketPrefixes.length}${NC} prefixes in bucket`);
  console.log("");

  // Step 3: Find orphans (in bucket but not in database)
  console.log(`${YELLOW}Step 3: Finding orphans...${NC}`);

  const orphans = bucketPrefixes.filter((prefix) => !validSpaces.has(prefix));

  if (orphans.length === 0) {
    console.log(`${GREEN}No orphans found! Bucket is clean.${NC}`);
    process.exit(0);
  }

  console.log(`Found ${RED}${orphans.length}${NC} orphaned prefixes, checking ages...`);
  console.log("");

  // Check orphans with file counts and timestamps
  interface OrphanInfo {
    prefix: string;
    fileCount: number;
    newestFile: Date | null;
    tooRecent: boolean;
  }

  const orphanInfos: OrphanInfo[] = [];
  let totalFiles = 0;
  let skippedCount = 0;

  for (let i = 0; i < orphans.length; i++) {
    const prefix = orphans[i];
    process.stdout.write(`\r  Checking ${i + 1}/${orphans.length}: ${prefix}...`.padEnd(60));

    let fileCount = 0;
    try {
      const output = exec(`gcloud storage ls "gs://${bucket}/${prefix}/"`);
      fileCount = output.split("\n").filter((line) => line.length > 0).length;
    } catch {
      // Empty or inaccessible
    }

    const newestFile = getNewestFileTime(bucket, prefix);
    const tooRecent = newestFile !== null && newestFile > cutoffTime;

    orphanInfos.push({ prefix, fileCount, newestFile, tooRecent });
    totalFiles += fileCount;
    if (tooRecent) skippedCount++;
  }
  console.log("\r".padEnd(70)); // Clear progress line

  // Show orphans
  for (const info of orphanInfos) {
    const ageStr = info.newestFile
      ? `newest: ${info.newestFile.toISOString()}`
      : "no timestamp";

    if (info.tooRecent) {
      console.log(`  ${YELLOW}${info.prefix}/${NC} (${info.fileCount} files, ${ageStr}) - SKIPPED (too recent)`);
    } else {
      console.log(`  ${info.prefix}/ (${info.fileCount} files, ${ageStr})`);
    }
  }

  const deletableOrphans = orphanInfos.filter((o) => !o.tooRecent);
  const deletableFiles = deletableOrphans.reduce((sum, o) => sum + o.fileCount, 0);

  console.log("");
  console.log(`Total: ${RED}${orphans.length}${NC} orphan prefixes, ${RED}${totalFiles}${NC} files`);
  if (skippedCount > 0) {
    console.log(`Skipped: ${YELLOW}${skippedCount}${NC} prefixes (newer than ${minAgeHours}h)`);
    console.log(`Deletable: ${RED}${deletableOrphans.length}${NC} prefixes, ${RED}${deletableFiles}${NC} files`);
  }
  console.log("");

  if (deletableOrphans.length === 0) {
    console.log(`${GREEN}No orphans old enough to delete.${NC}`);
    process.exit(0);
  }

  // Step 4: Delete if --execute flag is set
  if (execute) {
    console.log(`${RED}=== DELETING ORPHANS ===${NC}`);
    console.log("");

    const confirm = await prompt("Are you sure you want to delete these files? (yes/no): ");
    if (confirm !== "yes") {
      console.log("Aborted.");
      process.exit(1);
    }

    console.log("");
    for (const info of deletableOrphans) {
      process.stdout.write(`Deleting gs://${bucket}/${info.prefix}/... `);
      try {
        exec(`gcloud storage rm -r "gs://${bucket}/${info.prefix}/"`);
        console.log(`${GREEN}done${NC}`);
      } catch {
        console.log(`${RED}failed${NC}`);
      }
    }

    console.log("");
    console.log(`${GREEN}Cleanup complete!${NC}`);
  } else {
    console.log(`${YELLOW}This was a dry run. To actually delete, run:${NC}`);
    console.log(`  npx tsx scripts/cleanup-orphaned-media.ts ${envName} --execute`);
  }
}

main().catch((error) => {
  console.error(`${RED}Error:${NC}`, error.message);
  process.exit(1);
});
