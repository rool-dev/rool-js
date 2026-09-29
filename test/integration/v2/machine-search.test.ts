import assert from "node:assert/strict";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";
const client = createTestClient();
const cleanup = new MachineCleanup(client);
async function main() {
  await requireLocalProxy();
  const created = cleanup.track(
    await client.createMachine({ name: `SDK search ${Date.now()}` }),
  );
  const machine = client.machine(created.id);
  const path = "/rool-drive/search-fixture.txt";
  await machine.files.write(path, "The R&D searchfixture budget is approved.");
  const page = await machine.search({
    query: "R&D searchfixture",
    types: ["files"],
  });
  assert.equal(page.results.length, 1);
  assert.equal(page.results[0].path, path);
  assert.match(page.results[0].snippet, /R&D/);
  assert.equal(
    (await machine.search({ query: "searchfixture", types: ["objects"] }))
      .results.length,
    0,
  );
  await machine.files.write(path, "Replaced text");
  assert.equal(
    (await machine.search({ query: "searchfixture", types: ["files"] })).results
      .length,
    0,
  );
  console.log("SDK machine search smoke test passed.");
}
runSmokeTest(main, () => cleanup.cleanup());
