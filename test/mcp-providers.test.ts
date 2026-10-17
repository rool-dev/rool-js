import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoolClient,
  RoolProblem,
  type CreateMcpConnection,
  type MachineMcpProvidersApi,
  type McpAuthorization,
  type McpProvider,
} from "../src/index.js";

const provider: McpProvider = {
  id: "provider/id",
  name: "Example",
  description: "Connect your documents and calendar.",
  logoUrl: "https://example.test/logo.png",
};

for (const [name, providers] of [
  ["available providers", [provider]],
  ["no available providers", []],
  ["older backend with nested templates", [{ ...provider, templates: [{ id: "documents" }] }]],
] as const) {
  test(`lists ${name}`, async () => {
    const client = new RoolClient({
      apiUrl: "https://api.example.test",
      fetch: async (input, init) => {
        assert.equal(String(input), "https://api.example.test/v2/mcp-providers");
        assert.equal(init?.method ?? "GET", "GET");
        return Response.json({ providers });
      },
    });
    const result: McpProvider[] = await client.listMcpProviders();
    assert.deepEqual(
      result.map(({ id, name, description, logoUrl }) => ({ id, name, description, logoUrl })),
      providers.length ? [provider] : [],
    );
  });
}

test("provider authorization encodes IDs and does not create a connection first", async () => {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const authorization: McpAuthorization = {
    authorizationUrl: "https://example.test/authorize",
    expiresAt: "2026-09-02T13:42:44.165Z",
  };
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      requests.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body });
      return Response.json(authorization);
    },
  });
  const providers: MachineMcpProvidersApi = client.machine("machine/id").mcpProviders;
  assert.deepEqual(await providers.startAuthorization(provider.id), authorization);
  assert.deepEqual(requests, [{
    path: "/v2/machines/machine%2Fid/mcp-providers/provider%2Fid/authorization",
    method: "POST",
    body: undefined,
  }]);
});

test("provider authorization preserves API errors", async () => {
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async () => Response.json({
      type: "about:blank",
      title: "MCP provider not found",
      status: 404,
      code: "mcp_provider_not_found",
      detail: "MCP provider not found or unavailable",
    }, { status: 404, headers: { "Content-Type": "application/problem+json" } }),
  });
  await assert.rejects(
    client.machine("machine").mcpProviders.startAuthorization("unavailable"),
    (error: unknown) => error instanceof RoolProblem && error.status === 404 && error.code === "mcp_provider_not_found",
  );
});

// Compiled by typecheck, never run: removed template APIs must not remain public.
function checkPublicTypes(client: RoolClient, provider: McpProvider): void {
  // @ts-expect-error Templates are internal to the backend.
  provider.templates;
  // @ts-expect-error The template listing method was removed in SDK 3.
  client.listMcpConnectionTemplates();
  // @ts-expect-error Connections can no longer be created by template ID.
  const input: CreateMcpConnection = { templateId: "documents" };
  void input;
}
void checkPublicTypes;
