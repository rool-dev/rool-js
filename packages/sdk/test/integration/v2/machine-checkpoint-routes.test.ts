/**
 * Smoke test for checkpoint navigation and file-tree reconciliation through the
 * SDK and local machine router.
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  MachineCheckpointCollection,
  MachineFilePath,
  MachineFiles,
  MachineFileTreeChange,
  RoolMachine,
} from "../../../src/index.js";
import { expectProblem } from "./assertions.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalRouter,
  runSmokeTest,
  waitForFileTree,
} from "./harness.js";

const CHECKPOINT_WAIT_MS = 90_000;
const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

async function waitForBaseCheckpoint(
  machine: RoolMachine,
): Promise<MachineCheckpointCollection> {
  const deadline = Date.now() + CHECKPOINT_WAIT_MS;
  while (Date.now() < deadline) {
    const collection = await machine.checkpoints.list();
    if (collection.baseCheckpointId) return collection;
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
  await requireLocalRouter();

  const created = machineCleanup.track(
    await client.createMachine({
      name: `SDK checkpoint navigation ${Date.now()}`,
    }),
  );
  const machine = client.machine(created.id);
  const files = machine.files;
  const path: MachineFilePath = "/rool-drive/checkpoints/navigation.txt";
  const changes: MachineFileTreeChange[] = [];
  files.tree.subscribe((change) => changes.push(change));
  await files.watch();

  console.log(
    "Writing the first filesystem state and awaiting its checkpoint...",
  );
  const firstWrite = await files.write(path, "first version", {
    createParents: true,
    contentType: "text/plain",
  });
  const firstCollection = await waitForBaseCheckpoint(machine);
  const firstCheckpointId = firstCollection.baseCheckpointId;
  assert(firstCheckpointId);
  assert(
    firstCollection.checkpoints.some(
      (checkpoint) => checkpoint.id === firstCheckpointId,
    ),
  );

  console.log("Restoring the first state while preserving the second...");
  const secondWrite = await files.write(path, "second version", {
    contentType: "text/plain",
  });
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === secondWrite.etag,
  );
  let resetCount = changes.filter((change) => change.reset).length;

  await machine.checkpoints.restore(firstCheckpointId);
  await waitForFileTree(files, () => files.tree.etag(path) === firstWrite.etag);
  assert.equal(await readText(files, path), "first version");
  assert(
    changes.filter((change) => change.reset).length > resetCount,
    "checkpoint restore did not reconcile after sync-token invalidation",
  );

  const afterFirstRestore = await machine.checkpoints.list();
  const secondCheckpoint = afterFirstRestore.checkpoints.find(
    (checkpoint) => checkpoint.id !== firstCheckpointId,
  );
  assert(secondCheckpoint, "the uncheckpointed second state was not preserved");
  assert.equal(afterFirstRestore.baseCheckpointId, firstCheckpointId);

  console.log("Navigating forward and backward through SDK checkpoints...");
  resetCount = changes.filter((change) => change.reset).length;
  await machine.checkpoints.restore(secondCheckpoint.id);
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === secondWrite.etag,
  );
  assert.equal(await readText(files, path), "second version");
  assert(changes.filter((change) => change.reset).length > resetCount);

  resetCount = changes.filter((change) => change.reset).length;
  await machine.checkpoints.restore(firstCheckpointId);
  await waitForFileTree(files, () => files.tree.etag(path) === firstWrite.etag);
  assert.equal(await readText(files, path), "first version");
  assert(changes.filter((change) => change.reset).length > resetCount);
  assert(
    (await machine.checkpoints.list()).checkpoints.some(
      (checkpoint) => checkpoint.id === secondCheckpoint.id,
    ),
    "backward navigation discarded the later checkpoint",
  );

  console.log("Replacing the later timeline after editing an earlier state...");
  const branchWrite = await files.write(path, "branched version", {
    contentType: "text/plain",
  });
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === branchWrite.etag,
  );
  assert(
    !(await machine.checkpoints.list()).checkpoints.some(
      (checkpoint) => checkpoint.id === secondCheckpoint.id,
    ),
    "a later checkpoint remained restorable after the earlier state changed",
  );
  await expectProblem(
    () => machine.checkpoints.restore(secondCheckpoint.id),
    404,
    "checkpoint_not_found",
  );

  await machine.checkpoints.restore(firstCheckpointId);
  await waitForFileTree(files, () => files.tree.etag(path) === firstWrite.etag);
  assert.equal(await readText(files, path), "first version");
  const afterBranch = await machine.checkpoints.list();
  const branchCheckpoint = afterBranch.checkpoints.find(
    (checkpoint) => checkpoint.id !== firstCheckpointId,
  );
  assert(branchCheckpoint, "the branched file state was not checkpointed");
  assert.notEqual(branchCheckpoint.id, secondCheckpoint.id);

  await machine.checkpoints.restore(branchCheckpoint.id);
  await waitForFileTree(
    files,
    () => files.tree.etag(path) === branchWrite.etag,
  );
  assert.equal(await readText(files, path), "branched version");

  files.unwatch();
  console.log("\n✅ SDK checkpoint smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
