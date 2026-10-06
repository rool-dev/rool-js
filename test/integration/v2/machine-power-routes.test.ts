/**
 * Local integration test for SDK machine stop and CPU/memory reporting.
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { MachineResources } from "../../../src/index.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);

function load(a: MachineResources, b: MachineResources): number {
  assert(a.running && b.running);
  return (
    (b.cpuBusySeconds - a.cpuBusySeconds) /
    ((b.uptimeSeconds - a.uptimeSeconds) * b.vcpus)
  );
}

async function main(): Promise<void> {
  await requireLocalProxy();

  const created = machineCleanup.track(
    await client.createMachine({ name: `SDK machine power ${Date.now()}` }),
  );
  const machine = client.machine(created.id);

  console.log("A machine that has not started reports no resources...");
  assert.deepEqual(await machine.getResources(), { running: false });

  console.log("A running machine reports its CPU and memory...");
  await machine.exec({ command: "true" });
  const idle = await machine.getResources();
  assert(idle.running);
  assert(idle.vcpus >= 1);
  assert(idle.memAvailableBytes > 0 && idle.memAvailableBytes <= idle.memTotalBytes);

  const busy = machine.exec({
    command: "timeout 4 sh -c 'while :; do :; done' & timeout 4 sh -c 'while :; do :; done' & wait",
  });
  await sleep(1_000);
  const a = await machine.getResources();
  await sleep(2_000);
  const b = await machine.getResources();
  await busy;
  assert(load(a, b) > 0.8, `two busy loops read as ${load(a, b)}`);

  console.log("Stopping keeps the machine's files and leaves it stopped...");
  await machine.files.write("/rool-drive/power.txt", "kept", {
    contentType: "text/plain",
  });
  await machine.stop();
  assert.deepEqual(await machine.getResources(), { running: false });
  await machine.stop();
  assert.deepEqual(await machine.getResources(), { running: false });

  console.log("The next request starts it again...");
  const result = await machine.exec({ command: "cat /rool-drive/power.txt" });
  assert.equal(result.stdout, "kept");
  assert.equal((await machine.getResources()).running, true);

  console.log("\n✅ SDK machine power smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
