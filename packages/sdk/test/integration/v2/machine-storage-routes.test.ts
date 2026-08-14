/**
 * Smoke test for SDK whole-machine live storage reporting through the local
 * machine router.
 */

import assert from "node:assert/strict";
import type { MachineFilePath } from "../../../src/index.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalRouter,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

async function main(): Promise<void> {
  await requireLocalRouter();

  const created = machineCleanup.track(
    await client.createMachine({
      name: `SDK machine storage ${Date.now()}`,
    }),
  );
  const files = client.machine(created.id).files;

  console.log("Reading whole-machine live storage...");
  const before = await files.getStorageUsage();
  assert(before.usedBytes > 0);
  assert(before.availableBytes > 0);

  console.log("Charging an upload to the shared machine filesystem...");
  const path: MachineFilePath = `/rool-drive/storage-${Date.now()}.bin`;
  const body = new Uint8Array(2 * 1024 * 1024).fill(0x5a);
  await files.write(path, body, { contentType: "application/octet-stream" });

  const after = await files.getStorageUsage();
  assert(
    after.usedBytes >= before.usedBytes + body.byteLength,
    `machine usage grew by only ${after.usedBytes - before.usedBytes} bytes`,
  );
  assert(
    after.availableBytes <= before.availableBytes - body.byteLength,
    `machine availability fell by only ${before.availableBytes - after.availableBytes} bytes`,
  );

  console.log("\n✅ SDK whole-machine storage smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
