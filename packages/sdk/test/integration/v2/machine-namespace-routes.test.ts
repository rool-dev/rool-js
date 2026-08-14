/**
 * Smoke test for SDK filesystem enumeration and namespace operations through
 * the local machine router.
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

  const machine = machineCleanup.track(
    await client.createMachine({
      name: `SDK filesystem namespace ${Date.now()}`,
    }),
  );
  const files = client.machine(machine.id).files;
  const directory: MachineFilePath = `/rool-drive/sdk-namespace-${Date.now()}`;
  const nestedDirectory: MachineFilePath = `${directory}/nested`;
  const source: MachineFilePath = `${directory}/source & notes.txt`;
  const nested: MachineFilePath = `${nestedDirectory}/inside.txt`;

  console.log("Enumerating machine storage roots...");
  const roots = await files.list();
  assert.deepEqual(
    roots.map((entry) => [entry.path, entry.kind]),
    [
      ["/rool-drive", "directory"],
      ["/space", "directory"],
    ],
  );

  console.log("Creating and enumerating directories...");
  await expectFileError(
    () => files.createDirectory(`${directory}/missing/child`),
    409,
  );
  await files.createDirectory(directory);
  await files.createDirectory(nestedDirectory);
  await files.createDirectory(`${directory}/empty`);
  await expectFileError(() => files.createDirectory(directory), 405);

  await files.write(source, "source", { contentType: "text/plain" });
  await files.write(nested, "nested", { contentType: "text/plain" });

  const directoryInfo = await files.stat(directory);
  assert.equal(directoryInfo.kind, "directory");
  const sourceInfo = await files.stat(source);
  assert.equal(sourceInfo.kind, "file");
  assert.equal(sourceInfo.name, "source & notes.txt");
  if (sourceInfo.kind !== "file") throw new Error("source is not a file");
  assert.equal(sourceInfo.size, 6);
  assert.match(sourceInfo.contentType, /^text\/plain/);

  const direct = await files.list(directory);
  assert.deepEqual(
    direct.map((entry) => entry.path).sort(),
    [`${directory}/empty`, nestedDirectory, source].sort(),
  );
  const recursive = await files.list(directory, { recursive: true });
  assert(recursive.some((entry) => entry.path === nested));

  console.log("Copying and moving files with destination preconditions...");
  const copied: MachineFilePath = `${directory}/copied.txt`;
  assert.deepEqual(await files.copy(source, copied, { overwrite: false }), {
    source,
    destination: copied,
    overwritten: false,
  });
  await expectFileError(
    () => files.copy(source, copied, { overwrite: false }),
    412,
  );
  assert.equal(await (await files.read(copied)).text(), "source");

  const moved: MachineFilePath = `${directory}/moved.txt`;
  assert.deepEqual(await files.move(copied, moved), {
    source: copied,
    destination: moved,
    overwritten: false,
  });
  await expectFileError(() => files.read(copied), 404);
  assert.equal(await (await files.read(moved)).text(), "source");

  console.log("Copying directory trees recursively and shallowly...");
  const recursiveCopy: MachineFilePath = `${directory}-recursive-copy`;
  await files.copy(directory, recursiveCopy);
  assert.equal(
    await (await files.read(`${recursiveCopy}/nested/inside.txt`)).text(),
    "nested",
  );

  const shallowCopy: MachineFilePath = `${directory}-shallow-copy`;
  await files.copy(directory, shallowCopy, { recursive: false });
  assert.equal((await files.list(shallowCopy, { recursive: true })).length, 0);

  console.log("\n✅ SDK filesystem namespace smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
