/** Local MCP smoke test. Reads existing state without starting external OAuth consent. */
import assert from "node:assert/strict";
import { expectProblem } from "./assertions.js";
import { createTestClient, requireLocalProxy, runSmokeTest } from "./harness.js";

const client = createTestClient();
const unauthenticatedClient = createTestClient(null);

async function main(): Promise<void> {
  await requireLocalProxy();

  console.log("Checking MCP provider authentication and catalog...");
  await expectProblem(
    () => unauthenticatedClient.listMcpProviders(),
    401,
    "authentication_required",
  );
  const providers = await client.listMcpProviders();
  assert(Array.isArray(providers));
  for (const provider of providers) {
    assert.equal(typeof provider.id, "string");
    assert.equal(typeof provider.name, "string");
    assert.equal(typeof provider.description, "string");
    assert.equal(new URL(provider.logoUrl).protocol, "https:");
  }

  const machines = await client.listMachines();
  const owned = machines.find(({ role }) => role === "owner" || role === "admin");
  assert(owned, "MCP smoke test requires an existing machine owned or administered by the test user");
  const machine = client.machine(owned.id);

  console.log("Reading connections and checking provider authorization errors...");
  const connections = await machine.mcpConnections.list();
  for (const connection of connections) {
    assert.deepEqual(await machine.mcpConnections.get(connection.id), connection);
  }
  await expectProblem(
    () => unauthenticatedClient.machine(owned.id).mcpProviders.startAuthorization("sdk-no-such-provider"),
    401,
    "authentication_required",
  );
  await expectProblem(
    () => machine.mcpProviders.startAuthorization("sdk-no-such-provider"),
    404,
    "mcp_provider_not_found",
  );
  assert.deepEqual(await machine.mcpConnections.list(), connections);
  console.log("MCP provider and connection routes passed.");
}

runSmokeTest(main, async () => {});
