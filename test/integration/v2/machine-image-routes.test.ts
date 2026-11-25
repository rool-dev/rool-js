/**
 * Local integration test for the SDK machine image API: what a stock machine
 * and an account without machine images report, and the Hub's read routes.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertIsoDate, expectProblem } from "./assertions.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

async function main(): Promise<void> {
  await requireLocalProxy();

  console.log("Every plan says whether it includes editing machine images...");
  const { plans } = await client.getPlans();
  for (const plan of plans) {
    assert.equal(typeof plan.machineImages, "boolean");
  }

  console.log("An account lists its machine images...");
  const home = (await client.getAccounts()).find((account) => account.home);
  assert(home);
  for (const image of await client.account(home.id).machineImages.list()) {
    assert.deepEqual(await client.machineImage(image.id).get(), image);
    assert(image.revisions.some((r) => r.revision === image.defaultRevision));
    for (const revision of image.revisions) {
      assert.equal(typeof revision.stepCount, "number");
      assert.equal(typeof revision.fileCount, "number");
      assertIsoDate(revision.createdAt);
    }
  }

  console.log("The Hub lists machine images and shows one...");
  const listed = await client.hub.machineImages.list();
  for (const image of listed) assertIsoDate(image.publishedAt);
  if (listed[0]) {
    const { recipe, files, ...summary } = await client.hub.machineImages.get(
      listed[0].id,
    );
    assert.deepEqual(summary, listed[0]);
    assert.equal(recipe.length, summary.stepCount);
    assert.equal(files.length, summary.fileCount);
  }
  await expectProblem(
    () => client.hub.machineImages.get(randomUUID()),
    404,
    "machine_image_not_listed",
  );

  console.log("A new machine runs the stock system...");
  const created = machineCleanup.track(
    await client.createMachine({ name: `SDK machine image ${Date.now()}` }),
  );
  assert.equal(created.machineImage, null);
  const { editRefusal, ...state } = await client
    .machine(created.id)
    .machineImage.get();
  assert.deepEqual(state, {
    machineImage: null,
    editing: false,
    changing: false,
    error: null,
    bootFailure: null,
  });
  assert([null, "plan"].includes(editRefusal));

  console.log("\n✅ SDK machine image smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
