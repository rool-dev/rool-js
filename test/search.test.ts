import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient, RoolProblem } from "../src/index.js";
test("machine search encodes the query and forwards scope, cursor and cancellation", async () => {
  const controller = new AbortController();
  const page = { results: [], nextCursor: null, incomplete: false };
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v2/machines/test/search");
      assert.equal(url.searchParams.get("q"), "R&D / café?");
      assert.equal(url.searchParams.get("types"), "conversations,objects");
      assert.equal(url.searchParams.get("cursor"), "next");
      assert.equal(url.searchParams.get("limit"), "10");
      assert.equal(init?.signal, controller.signal);
      return Response.json(page);
    },
  });
  assert.deepEqual(
    await client.machine("test").search({
      query: "R&D / café?",
      types: ["conversations", "objects"],
      cursor: "next",
      limit: 10,
      signal: controller.signal,
    }),
    page,
  );
});

test("machine search uses server defaults and preserves busy errors for callers", async () => {
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.deepEqual([...url.searchParams], [["q", "lighthouse"]]);
      return Response.json(
        {
          type: "about:blank",
          title: "Search is busy",
          status: 429,
          code: "search_busy",
        },
        { status: 429 },
      );
    },
  });
  await assert.rejects(
    client.machine("test").search({ query: "lighthouse" }),
    (error: unknown) =>
      error instanceof RoolProblem &&
      error.status === 429 &&
      error.code === "search_busy",
  );
});

test("machine search never sends an already cancelled query", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async () => {
      throw new Error("Cancelled search reached the network");
    },
  });
  await assert.rejects(
    client.machine("test").search({
      query: "lighthouse",
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});
