/**
 * Smoke test for SDK structured machine state through the local machine router.
 */

import assert from "node:assert/strict";
import {
  isRoolObjectPath,
  RoolFileError,
  type CollectionDef,
  type RoolObjectPath,
} from "../../../src/index.js";
import { createTestAuth } from "./auth.js";
import { expectFileError } from "./assertions.js";
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
let concurrentWritePath: string | null = null;
let concurrentDeletePath: string | null = null;

const conflictFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    concurrentWritePath &&
    init?.method === "PUT" &&
    url.pathname === concurrentWritePath
  ) {
    concurrentWritePath = null;
    const headers = new Headers(init.headers);
    const response = await routedFetch(input, {
      ...init,
      headers,
      body: JSON.stringify({ title: "Concurrent version", done: false }),
    });
    assert.equal(response.status, 200);
  }
  if (
    concurrentDeletePath &&
    init?.method === "DELETE" &&
    url.pathname === concurrentDeletePath
  ) {
    concurrentDeletePath = null;
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    const response = await routedFetch(input, {
      ...init,
      method: "PUT",
      headers,
      body: JSON.stringify({
        title: "Concurrent deletion version",
        done: false,
      }),
    });
    assert.equal(response.status, 204);
  }
  return routedFetch(input, init);
};

const client = createTestClient("primary", conflictFetch);
const machineCleanup = new MachineCleanup(client);

async function runGuest(machineId: string, command: string): Promise<void> {
  const response = await fetch(`${API_URL}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await auth.getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation StructuredGuestWrite($machineId: String!, $command: String!) {
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
      name: `SDK structured machine state ${Date.now()}`,
    }),
  );
  const machine = client.machine(created.id);
  assert.deepEqual(await machine.metadata.get(), {});
  await machine.files.watch();

  console.log("Setting structured machine metadata keys...");
  const viewport = { x: 10, y: 20, zoom: 1.5 };
  await Promise.all([
    machine.metadata.set("viewport", viewport),
    machine.metadata.set("theme", "dark"),
  ]);
  assert.deepEqual(await machine.metadata.get(), {
    viewport,
    theme: "dark",
  });
  await machine.metadata.delete("theme");
  assert.deepEqual(await machine.metadata.get(), { viewport });

  const initialDefinition: CollectionDef = {
    schemaOrgType: "Action",
    fields: [
      { name: "title", type: { kind: "string" } },
      { name: "done", type: { kind: "boolean" } },
    ],
  };
  console.log("Creating and reading a collection schema...");
  const collection = await machine.collections.create(
    "task",
    initialDefinition,
  );
  assert.equal(collection.name, "task");
  assert.equal(collection.path, "/space/task");
  assert.deepEqual(collection.definition, initialDefinition);
  await expectFileError(
    () => machine.collections.create("task", initialDefinition),
    412,
  );
  await waitForFileTree(
    machine.files,
    () =>
      machine.files.tree.etag("/space/task/.schema.json") === collection.etag,
  );
  assert.deepEqual(await machine.collections.list(), [collection]);

  const firstPath: RoolObjectPath = "/space/task/first.json";
  const missingPath: RoolObjectPath = "/space/task/missing.json";
  assert.equal(isRoolObjectPath(firstPath), true);
  assert.equal(isRoolObjectPath("/space/task/.schema.json"), false);
  console.log("Creating, listing, and hydrating structured objects...");
  const first = await machine.objects.create(firstPath, {
    title: "First task",
    done: false,
  });
  assert.deepEqual(first.body, { title: "First task", done: false });
  await expectFileError(
    () =>
      machine.objects.create(firstPath, {
        title: "Duplicate",
        done: false,
      }),
    412,
  );
  await waitForFileTree(
    machine.files,
    () => machine.files.tree.get(firstPath) !== undefined,
  );
  assert.deepEqual(machine.objects.list({ collection: "task" }), [firstPath]);
  const hydrated = await machine.objects.getMultiple([
    firstPath,
    missingPath,
    firstPath,
  ]);
  assert.deepEqual(hydrated, [first, undefined, first]);
  assert.deepEqual(await machine.objects.getMultiple([]), []);

  console.log("Rejecting a concurrent replacement with an ETag conflict...");
  concurrentWritePath = machine.files.href(firstPath);
  await expectFileError(
    () =>
      machine.objects.replace(firstPath, {
        title: "Stale replacement",
        done: true,
      }),
    412,
  );
  assert.deepEqual((await machine.objects.get(firstPath))?.body, {
    title: "Concurrent version",
    done: false,
  });

  console.log("Replacing the schema and patching and moving an object...");
  const updatedDefinition: CollectionDef = {
    ...initialDefinition,
    fields: [
      ...initialDefinition.fields,
      {
        name: "priority",
        type: { kind: "maybe", inner: { kind: "number" } },
      },
    ],
  };
  const updatedCollection = await machine.collections.replace(
    "task",
    updatedDefinition,
  );
  assert.deepEqual(updatedCollection.definition, updatedDefinition);
  const patched = await machine.objects.patch(firstPath, {
    done: true,
    priority: 2,
  });
  assert.deepEqual(patched.body, {
    title: "Concurrent version",
    done: true,
    priority: 2,
  });

  const renamedPath: RoolObjectPath = "/space/task/renamed.json";
  const renamed = await machine.objects.move(firstPath, renamedPath);
  assert.equal(renamed.path, renamedPath);
  assert.deepEqual(renamed.body, patched.body);
  await waitForFileTree(
    machine.files,
    () =>
      machine.files.tree.get(firstPath) === undefined &&
      machine.files.tree.get(renamedPath) !== undefined,
  );

  console.log("Consuming a guest-created object through the same file tree...");
  const guestPath: RoolObjectPath = "/space/task/guest.json";
  await runGuest(
    machine.id,
    `cat > /space/task/guest.json <<'JSON'\n{"title":"Guest task","done":false,"priority":3}\nJSON`,
  );
  await waitForFileTree(
    machine.files,
    () => machine.files.tree.get(guestPath) !== undefined,
  );
  assert.deepEqual((await machine.objects.get(guestPath))?.body, {
    title: "Guest task",
    done: false,
    priority: 3,
  });
  assert.deepEqual(machine.objects.list({ collection: "task" }), [
    guestPath,
    renamedPath,
  ]);

  console.log("Removing objects and their collection...");
  const directRemovePath: RoolObjectPath = "/space/task/direct-remove.json";
  await machine.objects.create(directRemovePath, {
    title: "Direct removal",
    done: true,
  });
  await machine.objects.remove(directRemovePath);
  assert.equal(await machine.objects.get(directRemovePath), undefined);

  concurrentDeletePath = machine.files.href(renamedPath);
  const removed = await machine.objects.removeMultiple([
    renamedPath,
    guestPath,
  ]);
  assert.equal(removed[0]?.ok, false);
  if (removed[0]?.ok === false) {
    assert.ok(removed[0].error instanceof RoolFileError);
    assert.equal(removed[0].error.status, 412);
  }
  assert.deepEqual(removed[1], { ok: true, path: guestPath });
  assert.deepEqual((await machine.objects.get(renamedPath))?.body, {
    title: "Concurrent deletion version",
    done: false,
  });
  assert.deepEqual(await machine.objects.removeMultiple([renamedPath]), [
    { ok: true, path: renamedPath },
  ]);
  assert.deepEqual(await machine.objects.removeMultiple([]), []);
  await machine.collections.remove("task");
  assert.equal(await machine.collections.get("task"), undefined);
  await waitForFileTree(
    machine.files,
    () => machine.files.tree.get("/space/task") === undefined,
  );
  assert.deepEqual(machine.objects.list({ collection: "task" }), []);
  assert.equal(machine.files.watchError, null);
  machine.files.unwatch();

  console.log("\n✅ SDK structured machine state smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
