/**
 * Smoke test for the SDK's known-path machine file API through the local router.
 *
 * Environment:
 *   ROOL_TEST_API_URL (default http://localhost:1357)
 *   ROOL_TEST_AUTH_URL when the API targets loopback
 *   ROOL_TEST_ROUTER_URL (default http://localhost:8080)
 */

import assert from "node:assert/strict";
import { RoolFileError, type MachineFilePath } from "../../../src/index.js";
import { expectFileError } from "./assertions.js";
import {
  createRoutedFetch,
  createTestClient,
  MachineCleanup,
  requireLocalRouter,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);
const MAX_ROOL_DRIVE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_SPACE_UPLOAD_BYTES = 25 * 1024 * 1024;

function stream(body: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const middle = Math.floor(body.length / 2);
      controller.enqueue(body.subarray(0, middle));
      controller.enqueue(body.subarray(middle));
      controller.close();
    },
  });
}

async function main(): Promise<void> {
  await requireLocalRouter();

  const machine = machineCleanup.track(
    await client.createMachine({
      name: `SDK known-path files ${Date.now()}`,
    }),
  );
  const files = client.machine(machine.id).files;
  const routedFetch = createRoutedFetch();
  let uploadAttempts = 0;
  const retryingClient = createTestClient("primary", async (input, init) => {
    uploadAttempts++;
    if (uploadAttempts === 1) {
      if (init?.body instanceof ReadableStream) {
        await new Response(init.body).arrayBuffer();
      }
      return new Response(null, {
        status: 421,
        headers: { "Rool-Machine-Route-Changed": "1" },
      });
    }
    return routedFetch(input, init);
  });
  const retryingFiles = retryingClient.machine(machine.id).files;

  console.log("Checking machine file capabilities...");
  assert.deepEqual(await files.options(), {
    methods: [
      "OPTIONS",
      "PROPFIND",
      "REPORT",
      "GET",
      "HEAD",
      "PUT",
      "DELETE",
      "MKCOL",
      "MOVE",
      "COPY",
    ],
    acceptsRanges: true,
    createsParents: true,
    readsMultiple: true,
    synchronizes: true,
    maxUploadBytes: null,
  });
  assert.equal(
    (await files.options("/rool-drive")).maxUploadBytes,
    MAX_ROOL_DRIVE_UPLOAD_BYTES,
  );
  assert.equal(
    (await files.options("/space/.meta.json")).maxUploadBytes,
    MAX_SPACE_UPLOAD_BYTES,
  );

  console.log("Streaming, statting, and reading a machine file...");
  const path: MachineFilePath = "/rool-drive/sdk-known-path/nested/file.bin";
  const body = new Uint8Array(256 * 1024);
  for (let index = 0; index < body.length; index++) body[index] = index % 239;
  const uploadProgress: number[] = [];
  const written = await retryingFiles.write(path, () => stream(body), {
    contentType: "application/octet-stream",
    createParents: true,
    ifNoneMatch: "*",
    onUploadProgress: ({ transferredBytes, totalBytes }) => {
      assert.equal(totalBytes, undefined);
      uploadProgress.push(transferredBytes);
    },
  });
  assert.equal(uploadAttempts, 2);
  assert.equal(uploadProgress[0], 0);
  assert.equal(uploadProgress.at(-1), body.length);
  assert.equal(
    uploadProgress.every(
      (transferredBytes) =>
        transferredBytes >= 0 && transferredBytes <= body.length,
    ),
    true,
  );
  assert.equal(
    uploadProgress.filter((transferredBytes) => transferredBytes === 0).length,
    2,
  );
  assert.equal(written.path, path);
  assert.match(written.etag, /^"/);
  assert.equal(written.kind, "file");
  if (written.kind !== "file") throw new Error("written path is not a file");
  assert.equal(written.size, body.length);
  assert.equal(written.contentType, "application/octet-stream");

  const info = await files.stat(path);
  assert.deepEqual(info, written);

  const full = await files.read(path);
  assert.equal(full.status, 200);
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), body);

  const ranged = await files.read(path, { range: { start: 500, end: 799 } });
  assert.equal(ranged.status, 206);
  assert.equal(
    ranged.headers.get("Content-Range"),
    `bytes 500-799/${body.length}`,
  );
  assert.deepEqual(
    new Uint8Array(await ranged.arrayBuffer()),
    body.subarray(500, 800),
  );

  const suffix = await files.read(path, { range: { suffixLength: 11 } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(
    new Uint8Array(await suffix.arrayBuffer()),
    body.subarray(-11),
  );

  const notModified = await files.read(path, { ifNoneMatch: info.etag });
  assert.equal(notModified.status, 304);
  await expectFileError(
    () => files.write(path, "rejected", { ifMatch: '"wrong"' }),
    412,
  );

  console.log("Replacing with preconditions and writing /space metadata...");
  const replacement = await files.write(path, "replacement", {
    ifMatch: info.etag,
    contentType: "text/plain",
  });
  assert.equal(replacement.kind, "file");
  if (replacement.kind !== "file") {
    throw new Error("replacement path is not a file");
  }
  assert.equal(replacement.size, "replacement".length);
  assert.notEqual(replacement.etag, info.etag);
  assert.deepEqual(await files.stat(path), replacement);

  const metaPath: MachineFilePath = "/space/.meta.json";
  await files.write(metaPath, JSON.stringify({ sdk: "known-path" }), {
    contentType: "application/json",
  });
  const metaResponse = await files.read(metaPath);
  assert.deepEqual(await metaResponse.json(), { sdk: "known-path" });

  console.log("Deleting with an ETag precondition...");
  await expectFileError(() => files.delete(path, { ifMatch: info.etag }), 412);
  await files.delete(path, { ifMatch: replacement.etag });
  await expectFileError(() => files.read(path), 404);

  console.log("Deleting multiple paths with independent preconditions...");
  const firstDeletePath: MachineFilePath =
    "/rool-drive/sdk-delete-multiple/first.txt";
  const secondDeletePath: MachineFilePath =
    "/rool-drive/sdk-delete-multiple/second.txt";
  const directoryDeletePath: MachineFilePath =
    "/rool-drive/sdk-delete-multiple/directory";
  const nestedDeletePath: MachineFilePath =
    "/rool-drive/sdk-delete-multiple/directory/nested.txt";
  const firstDelete = await files.write(firstDeletePath, "first", {
    createParents: true,
  });
  const secondDelete = await files.write(secondDeletePath, "second");
  await files.write(nestedDeletePath, "nested", { createParents: true });

  const deletions = await files.deleteMultiple([
    { path: firstDeletePath, ifMatch: firstDelete.etag },
    { path: secondDeletePath, ifMatch: '"wrong"' },
    directoryDeletePath,
  ]);
  assert.deepEqual(deletions[0], { ok: true, path: firstDeletePath });
  assert.equal(deletions[1]?.ok, false);
  if (deletions[1]?.ok === false) {
    assert.ok(deletions[1].error instanceof RoolFileError);
    assert.equal(deletions[1].error.status, 412);
  }
  assert.deepEqual(deletions[2], { ok: true, path: directoryDeletePath });
  await expectFileError(() => files.read(firstDeletePath), 404);
  assert.equal((await files.read(secondDeletePath)).status, 200);
  await expectFileError(() => files.read(nestedDeletePath), 404);
  assert.deepEqual(
    await files.deleteMultiple([
      { path: secondDeletePath, ifMatch: secondDelete.etag },
    ]),
    [{ ok: true, path: secondDeletePath }],
  );
  assert.deepEqual(await files.deleteMultiple([]), []);

  const missingParent: MachineFilePath = `/rool-drive/missing-${Date.now()}/file.txt`;
  await expectFileError(() => files.write(missingParent, "no parent"), 409);
  await files.write(missingParent, "with parent", { createParents: true });

  console.log("\n✅ SDK known-path machine file smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
