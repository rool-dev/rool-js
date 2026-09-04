/**
 * Local integration test for the SDK's remote MCP connection API.
 */

import assert from "node:assert/strict";
import type { McpConnection } from "../../../src/index.js";
import { assertIsoDate } from "./assertions.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";

const client = createTestClient();
const machineCleanup = new MachineCleanup(client);
let stopWatching = () => {};

function assertConnection(connection: McpConnection): void {
  assert.equal(typeof connection.id, "string");
  assert.equal(typeof connection.name, "string");
  assert.equal(typeof connection.url, "string");
  assertIsoDate(connection.createdAt);
  assertIsoDate(connection.updatedAt);
}

async function main(): Promise<void> {
  await requireLocalProxy();

  console.log("Listing MCP connection templates...");
  const templates = await client.listMcpConnectionTemplates();
  for (const template of templates) {
    assert.equal(typeof template.id, "string");
    assert.equal(typeof template.defaultAccess, "string");
    assert.ok(template.accessOptions.length > 0);
  }

  const createdMachine = machineCleanup.track(
    await client.createMachine({
      name: `SDK MCP connections ${Date.now()}`,
    }),
  );
  const machine = client.machine(createdMachine.id);
  const connections = machine.mcpConnections;
  let watchedConnections: readonly McpConnection[] = [];
  let watchLoading = true;
  let watchError: unknown = null;
  stopWatching = connections.watch((view) => {
    watchedConnections = view.connections;
    watchLoading = view.loading;
    watchError = view.error;
  });
  await waitFor(() => {
    if (watchError) throw watchError;
    return !watchLoading;
  });
  assert.deepEqual(watchedConnections, []);

  console.log("Creating and listing an MCP connection...");
  const created = await connections.create({
    name: "example",
    url: "https://example.com/mcp",
    authentication: { type: "none" },
  });
  assertConnection(created);
  assert.equal(created.name, "example");
  assert.equal(created.url, "https://example.com/mcp");
  assert.deepEqual(created.authentication, { type: "none" });
  assert.deepEqual(await connections.get(created.id), created);
  assert.deepEqual(await connections.list(), [created]);
  await waitFor(() => {
    if (watchError) throw watchError;
    return watchedConnections.some(({ id }) => id === created.id);
  });

  console.log("Replacing credentials without exposing their values...");
  const withHeaders = await connections.replaceAuthentication(created.id, {
    type: "headers",
    headers: { Authorization: "Bearer test-secret" },
  });
  assert.deepEqual(withHeaders.authentication, {
    type: "headers",
    headerNames: ["Authorization"],
  });

  const awaitingOAuth = await connections.replaceAuthentication(created.id, {
    type: "oauth",
  });
  assert.deepEqual(awaitingOAuth.authentication, {
    type: "oauth",
    authorized: false,
  });
  assert.deepEqual(
    (await connections.clearAuthorization(created.id)).authentication,
    { type: "oauth", authorized: false },
  );

  await connections.remove(created.id);
  assert.deepEqual(await connections.list(), []);
  await waitFor(() => {
    if (watchError) throw watchError;
    return watchedConnections.length === 0;
  });

  stopWatching();
  stopWatching = () => {};
  await machine.delete();
  machineCleanup.forget(createdMachine.id);
  console.log("\n✅ SDK MCP connection route smoke tests passed.");
}

async function cleanup(): Promise<void> {
  stopWatching();
  await machineCleanup.cleanup();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for MCP connection state");
}

runSmokeTest(main, cleanup);
