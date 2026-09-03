import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const smokeTests = [
  { name: "user routes", file: "user-routes.test.ts" },
  { name: "speechmatics token", file: "speechmatics-routes.test.ts" },
  { name: "account events", file: "event-routes.test.ts" },
  { name: "voucher routes", file: "voucher-routes.test.ts" },
  { name: "machine routes", file: "machine-routes.test.ts" },
  {
    name: "machine MCP connection routes",
    file: "mcp-connection-routes.test.ts",
  },
  {
    name: "member and invite routes",
    file: "member-invite-routes.test.ts",
  },
  { name: "machine file routes", file: "machine-file-routes.test.ts" },
  {
    name: "machine storage usage",
    file: "machine-storage-routes.test.ts",
  },
  {
    name: "machine read-multiple hydration",
    file: "machine-read-multiple-routes.test.ts",
  },
  {
    name: "structured machine state",
    file: "machine-structured-state.test.ts",
  },
  {
    name: "stock-agent prompting",
    file: "machine-agent-routes.test.ts",
  },
  {
    name: "machine filesystem namespace routes",
    file: "machine-namespace-routes.test.ts",
  },
  {
    name: "machine reactive synchronization",
    file: "machine-sync-routes.test.ts",
  },
  {
    name: "machine checkpoint navigation",
    file: "machine-checkpoint-routes.test.ts",
  },
];

for (const smokeTest of smokeTests) {
  console.log(`\nRunning SDK ${smokeTest.name} smoke tests...\n`);
  const testPath = fileURLToPath(new URL(smokeTest.file, import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", testPath], {
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\n✅ All SDK v2 smoke tests passed.");
