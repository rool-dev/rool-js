/**
 * Smoke test for the SDK-owned machine file tree and reactive sync loop through
 * the local machine router.
 */

import assert from "node:assert/strict";
import type {
  MachineFilePath,
  MachineFileTreeChange,
} from "../../../src/index.js";
import { createTestAuth } from "./auth.js";
import {
  API_URL,
  createRoutedFetch,
  createTestClient,
  MachineCleanup,
  requireLocalRouter,
  runSmokeTest,
  waitForFileTree,
} from "./harness.js";

const auth = createTestAuth(API_URL, "primary");
const routedFetch = createRoutedFetch();
let beforeInvalidIncrementalSync: (() => Promise<void>) | null = null;
let initialSyncRequests = 0;

const syncFetch: typeof fetch = async (input, init) => {
  let body = init?.body;
  const isSyncReport = init?.method === "REPORT" && typeof body === "string";
  const isIncremental =
    isSyncReport && /<(?:\w+:)?sync-token\b/i.test(body as string);
  if (isSyncReport && !isIncremental) initialSyncRequests += 1;
  if (isIncremental && beforeInvalidIncrementalSync) {
    const prepareFilesystem = beforeInvalidIncrementalSync;
    beforeInvalidIncrementalSync = null;
    await prepareFilesystem();
    body = (body as string).replace(
      /(<(?:\w+:)?sync-token\b[^>]*>)([^<]+)(<\/(?:\w+:)?sync-token>)/i,
      (_element, open: string, token: string, close: string) => {
        const parts = token.split(":");
        assert.equal(parts.length, 4, `unexpected sync token: ${token}`);
        parts[2] = (BigInt(parts[2]) + 1n).toString();
        return `${open}${parts.join(":")}${close}`;
      },
    );
  }

  return routedFetch(input, { ...init, body });
};

const client = createTestClient("primary", syncFetch);
const machineCleanup = new MachineCleanup(client);

async function runGuest(machineId: string, command: string): Promise<void> {
  const response = await fetch(`${API_URL}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await auth.getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation SyncGuestWrite($machineId: String!, $command: String!) {
        spaceExec(spaceId: $machineId, command: $command) {
          stdout
          stderr
          exitCode
        }
      }`,
      variables: { machineId, command },
    }),
  });
  const body = (await response.json()) as {
    data?: {
      spaceExec: { stdout: string; stderr: string; exitCode: number };
    };
    errors?: { message: string }[];
  };
  assert.equal(response.status, 200);
  assert.equal(body.errors, undefined, body.errors?.[0]?.message);
  assert.equal(
    body.data?.spaceExec.exitCode,
    0,
    body.data?.spaceExec.stderr || body.data?.spaceExec.stdout,
  );
}

async function main(): Promise<void> {
  await requireLocalRouter();

  const created = machineCleanup.track(
    await client.createMachine({
      name: `SDK reactive synchronization ${Date.now()}`,
    }),
  );
  const machine = client.machine(created.id);
  const files = machine.files;
  assert.equal(machine, client.machine(created.id));

  const namespace = `sdk-sync-${Date.now()}`;
  const reconciledPath: MachineFilePath = `/rool-drive/${namespace}/reconciled.txt`;
  const davPath: MachineFilePath = `/rool-drive/${namespace}/dav.txt`;
  const guestPath: MachineFilePath = `/rool-drive/${namespace}/guest.txt`;
  const changes: MachineFileTreeChange[] = [];
  files.tree.subscribe((change) => changes.push(change));

  console.log("Watching one SDK-owned file tree and ETag cache...");
  beforeInvalidIncrementalSync = async () => {
    await files.write(reconciledPath, "created before token invalidation", {
      createParents: true,
      contentType: "text/plain",
    });
  };
  await files.watch();
  assert.equal(files.isWatching, true);
  assert.deepEqual(
    files.tree.list().map((entry) => entry.path),
    ["/rool-drive", "/space"],
  );

  console.log("Reconciling the complete tree after token invalidation...");
  await waitForFileTree(
    files,
    () => files.tree.get(reconciledPath) !== undefined,
  );
  assert(
    initialSyncRequests >= 2,
    "invalid token did not trigger initial sync",
  );
  assert(
    changes.filter((change) => change.reset).length >= 2,
    "file tree was not atomically reconciled after invalidation",
  );

  console.log("Applying DAV changes through the long-poll sync loop...");
  const written = await files.write(davPath, "written through DAV", {
    contentType: "text/plain",
  });
  await waitForFileTree(files, () => files.tree.etag(davPath) === written.etag);
  assert.equal(files.tree.get(davPath)?.etag, written.etag);

  console.log(
    "Applying guest-created and guest-deleted files to the same tree...",
  );
  await runGuest(
    machine.id,
    `set -euo pipefail; printf 'written by guest' > '/rool-drive/${namespace}/guest.txt'; rm '/rool-drive/${namespace}/dav.txt'`,
  );
  await waitForFileTree(
    files,
    () =>
      files.tree.get(guestPath) !== undefined &&
      files.tree.get(davPath) === undefined,
  );
  assert.equal(files.tree.get(guestPath)?.kind, "file");
  assert.deepEqual(
    files.tree
      .list(`/rool-drive/${namespace}`)
      .map((entry) => entry.path)
      .sort(),
    [guestPath, reconciledPath].sort(),
  );
  assert.equal(files.watchError, null);

  files.unwatch();
  assert.equal(files.isWatching, false);
  console.log("\n✅ SDK reactive synchronization smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
