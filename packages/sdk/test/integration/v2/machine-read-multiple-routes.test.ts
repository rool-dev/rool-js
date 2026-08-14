/**
 * Smoke test for SDK read-multiple hydration through the local machine router.
 */

import assert from "node:assert/strict";
import type { MachineFilePath } from "../../../src/index.js";
import { expectFileError } from "./assertions.js";
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
      name: `SDK read-multiple hydration ${Date.now()}`,
    }),
  );
  const files = client.machine(created.id).files;
  const binaryPath: MachineFilePath = "/rool-drive/read-multiple/binary.bin";
  const metaPath: MachineFilePath = "/space/.meta.json";
  const missingPath: MachineFilePath = "/rool-drive/read-multiple/missing.txt";
  const binary = new Uint8Array([0, 10, 13, 45, 45, 255, 1, 2, 3]);
  const binaryWrite = await files.write(binaryPath, binary, {
    contentType: "application/octet-stream",
    createParents: true,
  });
  const metaWrite = await files.write(
    metaPath,
    JSON.stringify({ hydration: "batch" }),
    { contentType: "application/json" },
  );

  console.log(
    "Hydrating binary, structured, and missing files in one REPORT...",
  );
  const results = await files.readMultiple([binaryPath, metaPath, missingPath]);
  assert.equal(results.length, 3);
  const binaryResult = results[0];
  assert(binaryResult?.ok);
  assert.equal(binaryResult.path, binaryPath);
  assert.equal(binaryResult.etag, binaryWrite.etag);
  assert.equal(binaryResult.contentType, "application/octet-stream");
  assert.deepEqual(binaryResult.body, binary);

  const metaResult = results[1];
  assert(metaResult?.ok);
  assert.equal(metaResult.path, metaPath);
  assert.equal(metaResult.etag, metaWrite.etag);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(metaResult.body)), {
    hydration: "batch",
  });

  const missingResult = results[2];
  assert(missingResult && !missingResult.ok);
  assert.equal(missingResult.path, missingPath);
  assert.equal(missingResult.status, 404);
  assert.deepEqual(await files.readMultiple([]), []);

  console.log("Applying request and per-file hydration limits...");
  const oversizedPath: MachineFilePath =
    "/rool-drive/read-multiple/oversized.bin";
  await files.write(oversizedPath, new Uint8Array(2 * 1024 * 1024 + 1), {
    contentType: "application/octet-stream",
  });
  const [oversized] = await files.readMultiple([oversizedPath]);
  assert(oversized && !oversized.ok);
  assert.equal(oversized.status, 413);

  const excessive = Array.from(
    { length: 129 },
    (_, index) => `/rool-drive/read-multiple/file-${index}` as MachineFilePath,
  );
  await expectFileError(() => files.readMultiple(excessive), 413);

  console.log("\n✅ SDK read-multiple smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
