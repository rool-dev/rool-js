/**
 * Local integration test for SDK checkpoint restore and file-tree
 * reconciliation.
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  MachineCheckpoint,
  MachineFilePath,
  MachineFiles,
  MachineFileTreeChange,
  RoolMachine,
} from "../../../src/index.js";
import { expectProblem } from "./assertions.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
  waitForFileTree,
} from "./harness.js";

const CHECKPOINT_WAIT_MS = 90_000;
const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

async function waitForFirstCheckpoint(
  machine: RoolMachine,
): Promise<MachineCheckpoint> {
  const deadline = Date.now() + CHECKPOINT_WAIT_MS;
  while (Date.now() < deadline) {
    const [first] = await machine.checkpoints.list();
    if (first) return first;
    await sleep(1_000);
  }
  throw new Error("timed out waiting for the first automatic checkpoint");
}

async function readText(
  files: MachineFiles,
  path: MachineFilePath,
): Promise<string> {
  const response = await files.read(path);
  return response.text();
}

async function main(): Promise<void> {
  await requireLocalProxy();

  const created = machineCleanup.track(
    await client.createMachine({
      name: `SDK checkpoint restore ${Date.now()}`,
    }),
  );
  const machine = client.machine(created.id);
  const files = machine.files;
  const path: MachineFilePath = "/rool-drive/checkpoints/navigation.txt";
  const changes: MachineFileTreeChange[] = [];
  const resets = () => changes.filter((change) => change.reset).length;
  files.tree.subscribe((change) => changes.push(change));
  await files.watch();

  console.log(
    "Writing the first filesystem state and awaiting its checkpoint...",
  );
  const firstWrite = await files.write(path, "first version", {
    createParents: true,
    contentType: "text/plain",
  });
  const first = await waitForFirstCheckpoint(machine);

  console.log("Restoring the first state over an unsaved second state...");
  const secondWrite = await files.write(path, "second version", {
    contentType: "text/plain",
  });
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === secondWrite.etag,
  );
  let resetCount = resets();
  const restored = await machine.checkpoints.restore(first.id);
  await waitForFileTree(files, () => files.tree.etag(path) === firstWrite.etag);
  assert.equal(await readText(files, path), "first version");
  assert(resets() > resetCount, "restore did not reset the watched file tree");
  assert.equal(restored.checkpoint.restoredFrom, first.createdAt);
  const secondId = restored.replacedCheckpointId;
  assert(secondId, "restore did not report the state it replaced");

  const afterRestore = await machine.checkpoints.list();
  assert.equal(afterRestore.at(-1)?.id, restored.checkpoint.id);
  assert.equal(
    afterRestore.find((checkpoint) => checkpoint.id === secondId)?.preRestore,
    true,
  );

  console.log("Restoring the current state changes nothing...");
  const unchanged = await machine.checkpoints.restore(restored.checkpoint.id);
  assert.equal(unchanged.replacedCheckpointId, null);

  console.log("Undoing the restore...");
  resetCount = resets();
  await machine.checkpoints.restore(secondId);
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === secondWrite.etag,
  );
  assert.equal(await readText(files, path), "second version");
  assert(resets() > resetCount);

  console.log("Editing after a restore keeps every later checkpoint...");
  const thirdWrite = await files.write(path, "third version", {
    contentType: "text/plain",
  });
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === thirdWrite.etag,
  );
  const backToFirst = await machine.checkpoints.restore(first.id);
  await waitForFileTree(files, () => files.tree.etag(path) === firstWrite.etag);
  const listed = new Set(
    (await machine.checkpoints.list()).map((checkpoint) => checkpoint.id),
  );
  for (const id of [first.id, secondId, restored.checkpoint.id]) {
    assert(listed.has(id), `checkpoint ${id} was discarded`);
  }
  const thirdId = backToFirst.replacedCheckpointId;
  assert(thirdId);
  await machine.checkpoints.restore(thirdId);
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === thirdWrite.etag,
  );
  assert.equal(await readText(files, path), "third version");

  await expectProblem(
    () => machine.checkpoints.restore("s0_00000000"),
    404,
    "checkpoint_not_found",
  );

  files.unwatch();
  console.log("\n✅ SDK checkpoint smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
