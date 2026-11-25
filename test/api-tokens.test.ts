import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient, RoolProblem, type ApiToken, type CreateApiToken } from "../src/index.js";

const token: ApiToken = {
  id: "roolapi_one",
  name: "CI",
  createdByUserId: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  lastUsedAt: null,
  grants: [{ machineId: "machine", actions: ["machine.exec"] }],
};

test("account API tokens use collection and item routes without caching secrets", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const created = { ...token, secret: "secret", token: "roolapi_one.secret" };
  const client = new RoolClient({
    apiUrl: "https://api.example",
    getTokens: () => ({ accessToken: "human", roolToken: "session" }),
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer human");
      assert.equal(headers.get("X-Rool-Token"), "session");
      const method = init?.method ?? "GET";
      if (init?.body) assert.equal(headers.get("Content-Type"), "application/json");
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === "PATCH" || method === "DELETE") return new Response(null, { status: 204 });
      if (method === "POST") return Response.json(created, { status: 201 });
      return Response.json(String(url).endsWith("/api-tokens") ? { tokens: [token] } : token);
    },
  });
  const api = client.account("account/one").apiTokens;
  const input: CreateApiToken = { name: token.name, grants: token.grants };
  assert.deepEqual(await api.create(input), created);
  assert.deepEqual(await api.list(), [token]);
  assert.deepEqual(await api.get("token/one"), token);
  assert.equal(await api.rename("token/one", "New name"), undefined);
  assert.equal(await api.revoke("token/one"), undefined);
  const path = "https://api.example/v2/accounts/account%2Fone/api-tokens";
  assert.deepEqual(calls, [
    { url: path, method: "POST", body: input },
    { url: path, method: "GET", body: null },
    { url: `${path}/token%2Fone`, method: "GET", body: null },
    { url: `${path}/token%2Fone`, method: "PATCH", body: { name: "New name" } },
    { url: `${path}/token%2Fone`, method: "DELETE", body: null },
  ]);
  assert.throws(() => api.get(""), /tokenId/);
  await assert.rejects(api.rename("", "name"), /tokenId/);
  await assert.rejects(api.revoke(""), /tokenId/);
  assert.equal(calls.length, 5);
});

test("token management preserves server problems on every operation", async () => {
  const client = new RoolClient({
    fetch: async () => Response.json({
      type: "about:blank", title: "Forbidden", status: 403,
      code: "forbidden", detail: "Human session required",
    }, { status: 403 }),
  });
  const api = client.account("account").apiTokens;
  for (const operation of [
    () => api.list(), () => api.get("token"),
    () => api.create({ name: "CI", grants: [] }),
    () => api.rename("token", "CI"), () => api.revoke("token"),
  ]) {
    await assert.rejects(operation, (error: unknown) => error instanceof RoolProblem && error.status === 403 && error.code === "forbidden");
  }
});

test("API token authentication sends only a Bearer token", async () => {
  const client = new RoolClient({
    apiToken: "roolapi_one.secret.with.dots",
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer roolapi_one.secret.with.dots");
      assert.equal(headers.has("X-Rool-Token"), false);
      return Response.json({});
    },
  });
  await client.machine("machine").get();
});

test("API tokens cannot be combined with session authentication or be empty", () => {
  assert.throws(() => new RoolClient({ apiToken: "token", getTokens: () => undefined }), /cannot be used together/);
  assert.throws(() => new RoolClient({ apiToken: "token", getAccessToken: () => "human" }), /cannot be used together/);
  for (const apiToken of ["", "  "]) assert.throws(() => new RoolClient({ apiToken }), /must not be empty/);
});

test("API token rejection invalidates authentication, permission denial does not", async () => {
  for (const status of [401, 403]) {
    let invalidations = 0;
    const client = new RoolClient({
      apiToken: "roolapi_one.secret",
      onAuthInvalidated: () => { invalidations++; },
      fetch: async () => Response.json({
        type: "about:blank", title: "Rejected", status, code: "rejected", detail: "Rejected",
      }, { status }),
    });
    await assert.rejects(() => client.machine("machine").get(), RoolProblem);
    assert.equal(invalidations, status === 401 ? 1 : 0);
  }
});
