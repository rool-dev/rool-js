import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient } from "../src/client.js";

test("sends access and Rool tokens from an external token provider", async () => {
  let headers: Headers | undefined;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    getTokens: () => ({
      accessToken: "access-token",
      roolToken: "rool-token",
    }),
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ title: "Hello", text: "World" });
    },
  });

  await client.getGreeting();

  assert.equal(headers?.get("Authorization"), "Bearer access-token");
  assert.equal(headers?.get("X-Rool-Token"), "rool-token");
});

test("reports invalidated authentication after a 401", async () => {
  let invalidations = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    getTokens: () => ({
      accessToken: "access-token",
      roolToken: "rool-token",
    }),
    onAuthInvalidated: () => {
      invalidations += 1;
    },
    fetch: async () =>
      Response.json(
        {
          type: "about:blank",
          title: "Invalid authentication",
          status: 401,
          code: "invalid_authentication",
          detail: "Sign in again",
        },
        { status: 401 },
      ),
  });

  await assert.rejects(() => client.getAccount());
  assert.equal(invalidations, 1);
});

test("keeps bearer-only external token providers working", async () => {
  let headers: Headers | undefined;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    getAccessToken: () => "access-token",
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ title: "Hello", text: "World" });
    },
  });

  await client.getGreeting();

  assert.equal(headers?.get("Authorization"), "Bearer access-token");
  assert.equal(headers?.has("X-Rool-Token"), false);
});
