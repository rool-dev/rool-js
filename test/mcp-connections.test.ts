import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoolClient,
  type MachineMcpConnectionsView,
  type McpConnection,
  type RoolClientEvent,
} from "../src/index.js";
import { RoolMachine, type RoolMachineTransport } from "../src/machine.js";

const connection: McpConnection = {
  id: "connection/id",
  name: "notion",
  url: "https://mcp.notion.com/mcp",
  authentication: { type: "oauth", authorized: false },
  createdAt: "2026-09-02T13:32:44.165Z",
  updatedAt: "2026-09-02T13:32:44.165Z",
};

test("machine MCP connections use the connection routes", async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ method, path: url.pathname, ...(body && { body }) });

      if (method === "DELETE" && url.pathname.endsWith("connection%2Fid")) {
        return new Response(null, { status: 204 });
      }
      if (method === "GET" && url.pathname.endsWith("mcp-connections")) {
        return Response.json({ connections: [connection] });
      }
      if (url.pathname.endsWith("/authorization") && method === "POST") {
        return Response.json({
          authorizationUrl: "https://notion.example/authorize",
          expiresAt: "2026-09-02T13:42:44.165Z",
        });
      }
      return Response.json(connection);
    },
  });
  const connections = client.machine("machine/id").mcpConnections;

  assert.deepEqual(await connections.list(), [connection]);
  assert.deepEqual(await connections.get("connection/id"), connection);
  assert.deepEqual(
    await connections.create({
      name: "notion",
      url: "https://mcp.notion.com/mcp",
      authentication: { type: "oauth" },
    }),
    connection,
  );
  assert.deepEqual(
    await connections.replaceAuthentication("connection/id", {
      type: "headers",
      headers: { Authorization: "Bearer secret" },
    }),
    connection,
  );
  assert.deepEqual(await connections.startAuthorization("connection/id"), {
    authorizationUrl: "https://notion.example/authorize",
    expiresAt: "2026-09-02T13:42:44.165Z",
  });
  assert.deepEqual(
    await connections.clearAuthorization("connection/id"),
    connection,
  );
  await connections.remove("connection/id");

  const base = "/v2/machines/machine%2Fid/mcp-connections";
  const item = `${base}/connection%2Fid`;
  assert.deepEqual(requests, [
    { method: "GET", path: base },
    { method: "GET", path: item },
    {
      method: "POST",
      path: base,
      body: {
        name: "notion",
        url: "https://mcp.notion.com/mcp",
        authentication: { type: "oauth" },
      },
    },
    {
      method: "PUT",
      path: `${item}/authentication`,
      body: {
        type: "headers",
        headers: { Authorization: "Bearer secret" },
      },
    },
    { method: "POST", path: `${item}/authorization` },
    { method: "DELETE", path: `${item}/authorization` },
    { method: "DELETE", path: item },
  ]);
});

test("watch keeps the MCP connection collection current", async () => {
  const eventListeners = new Set<(event: RoolClientEvent) => void>();
  let currentConnections = [connection];
  let listRequests = 0;
  let loadConnections = () => Promise.resolve(currentConnections);

  const transport: RoolMachineTransport = {
    send: async () => {
      throw new Error("Unexpected send");
    },
    request: async () => {
      throw new Error("Unexpected request");
    },
    requestJson: async <T>(path: string): Promise<T> => {
      assert.equal(path, "/v2/machines/machine/mcp-connections");
      listRequests++;
      return { connections: await loadConnections() } as T;
    },
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    deleted: () => {},
  };
  const connections = new RoolMachine("machine", transport).mcpConnections;
  const views: MachineMcpConnectionsView[] = [];
  const stop = connections.watch((view) => views.push(view));

  assert.deepEqual(
    [...views],
    [{ connections: [], loading: true, error: null }],
  );
  await waitFor(() => views.at(-1)?.loading === false);
  assert.deepEqual(views.at(-1)?.connections, [connection]);

  const initialRequestCount = listRequests;
  emit({
    type: "mcp_connections_changed",
    machineId: "another-machine",
    timestamp: 1,
  });
  await Promise.resolve();
  assert.equal(listRequests, initialRequestCount);

  const authorized: McpConnection = {
    ...connection,
    authentication: { type: "oauth", authorized: true },
  };
  currentConnections = [authorized];
  emit({
    type: "mcp_connections_changed",
    machineId: "machine",
    timestamp: 2,
  });
  await waitFor(() => {
    const authentication = views.at(-1)?.connections[0]?.authentication;
    return authentication?.type === "oauth" && authentication.authorized;
  });

  currentConnections = [];
  emit({ type: "session", session: {} } as RoolClientEvent);
  await waitFor(() => views.at(-1)?.connections.length === 0);

  const raceStart = views.length;
  const requestsBeforeRace = listRequests;
  let resolveStale: ((connections: McpConnection[]) => void) | undefined;
  loadConnections = () =>
    new Promise<McpConnection[]>((resolve) => {
      resolveStale = resolve;
    });
  emit({
    type: "mcp_connections_changed",
    machineId: "machine",
    timestamp: 3,
  });
  await waitFor(() => resolveStale !== undefined);

  loadConnections = () => Promise.resolve([authorized]);
  emit({
    type: "mcp_connections_changed",
    machineId: "machine",
    timestamp: 4,
  });
  emit({
    type: "mcp_connections_changed",
    machineId: "machine",
    timestamp: 5,
  });
  resolveStale!([connection]);

  await waitFor(() => views.at(-1)?.connections[0] === authorized);
  assert.equal(listRequests, requestsBeforeRace + 2);
  assert.equal(
    views.slice(raceStart).some((view) => {
      const authentication = view.connections[0]?.authentication;
      return authentication?.type === "oauth" && !authentication.authorized;
    }),
    false,
  );

  stop();
  assert.equal(eventListeners.size, 0);

  function emit(event: RoolClientEvent): void {
    for (const listener of eventListeners) listener(event);
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for MCP connection state");
}
