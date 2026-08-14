/**
 * Smoke test for the SDK machine API against the local backend and router.
 *
 * Environment:
 *   ROOL_TEST_API_URL (default http://localhost:1357)
 *   ROOL_TEST_AUTH_URL when the API targets loopback
 *   ROOL_TEST_ROUTER_URL (default http://localhost:8080)
 */

import assert from "node:assert/strict";
import type {
  MachineSettings,
  MachineSummary,
  RoolProblemDetails,
} from "../../../src/index.js";
import { assertMachineSummary, expectProblem } from "./assertions.js";
import {
  API_URL,
  ROUTER_URL,
  createTestClient,
  MachineCleanup,
  requireLocalRouter,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

async function main(): Promise<void> {
  await requireLocalRouter();
  console.log(`[test API] ${API_URL}\n[test router] ${ROUTER_URL}\n`);

  console.log("Creating and listing a machine...");
  const name = `SDK machine routes ${Date.now()}`;
  const created = machineCleanup.track(await client.createMachine({ name }));
  assertMachineSummary(created);
  assert.equal(created.name, name);
  assert.equal(created.role, "owner");
  assert.equal(created.memberCount, 1);

  const machines = await client.listMachines();
  machines.forEach(assertMachineSummary);
  assert(machines.some((machine) => machine.id === created.id));

  console.log("Reading machine identity and replacing settings...");
  const machine = client.machine(created.id);
  assert.equal(machine, client.machine(created.id));
  const details: MachineSummary = await machine.get();
  assertMachineSummary(details);
  assert.equal(details.id, created.id);
  assert.equal(details.inboundEmailAddress, created.inboundEmailAddress);
  assert.equal(details.state, "active");

  assert.deepEqual(await machine.settings.get(), { name });
  const renamed: MachineSettings = { name: `${name} renamed` };
  assert.deepEqual(await machine.settings.replace(renamed), renamed);
  assert.deepEqual(await machine.settings.get(), renamed);

  console.log("Fetching an external URL...");
  const fetched = await machine.fetchUrl("https://example.com/");
  assert.equal(fetched.status, 200);
  assert((await fetched.text()).includes("Example Domain"));

  const blocked = await machine.fetchUrl("http://127.0.0.1:1357/health");
  assert.equal(blocked.status, 403);
  const blockedProblem = (await blocked.json()) as RoolProblemDetails;
  assert.equal(blockedProblem.code, "destination_not_allowed");

  console.log("Duplicating and deleting machines...");
  const duplicate = machineCleanup.track(
    await machine.duplicate({ name: `${name} duplicate` }),
  );
  assertMachineSummary(duplicate);
  assert.notEqual(duplicate.id, created.id);
  assert.equal(duplicate.role, "owner");

  await client.machine(duplicate.id).delete();
  machineCleanup.forget(duplicate.id);
  await machine.delete();
  machineCleanup.forget(created.id);
  assert.notEqual(machine, client.machine(created.id));
  await expectProblem(() => machine.get(), 404, "not_found");

  console.log("\n✅ SDK machine route smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
