/**
 * Local integration test for SDK whole-machine live storage reporting.
 */

import assert from "node:assert/strict";
import type { MachineFilePath, MachineStorage } from "../../../src/index.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

function assertConsistent(storage: MachineStorage): void {
  const { files, conversations, objects, home, other } = storage.areas;
  assert.equal(
    files + conversations + objects + home + other,
    storage.usedBytes,
  );
  assert.equal(
    storage.availableBytes,
    Math.max(storage.planBytes - storage.usedBytes, 0),
  );
}

async function main(): Promise<void> {
  await requireLocalProxy();

  const created = machineCleanup.track(
    await client.createMachine({
      name: `SDK machine storage ${Date.now()}`,
    }),
  );
  const machine = client.machine(created.id);

  console.log("Reading machine storage...");
  const before = await machine.getStorage();
  assertConsistent(before);
  assert(before.usedBytes > 0);
  assert(before.availableBytes > 0);
  assert.equal(before.graceEndsAt, null);

  console.log("Charging an upload to the files area...");
  const path: MachineFilePath = `/rool-drive/storage-${Date.now()}.bin`;
  const body = new Uint8Array(2 * 1024 * 1024).fill(0x5a);
  await machine.files.write(path, body, {
    contentType: "application/octet-stream",
  });

  const after = await machine.getStorage();
  assertConsistent(after);
  assert(
    after.areas.files >= before.areas.files + body.byteLength,
    `files area grew by only ${after.areas.files - before.areas.files} bytes`,
  );
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
