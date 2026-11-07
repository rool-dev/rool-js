import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient, type MachineCheckpointRestore, type MachineResources } from "../src/index.js";

function clientAnswering(
  expect: { method: string; path: string },
  reply: () => Response,
): RoolClient {
  return new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, expect.path);
      assert.equal(init?.method ?? "GET", expect.method);
      return reply();
    },
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("stop posts to the machine's stop route", async () => {
  const client = clientAnswering({ method: "POST", path: "/v2/machines/m1/stop" }, () => new Response(null, { status: 204 }));
  await client.machine("m1").stop();
});

test("setType sends the type and returns the member's summary", async () => {
  const summary = { id: "m1", machineType: "R1", role: "admin" };
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/v2/machines/m1/type");
      assert.equal(init?.method, "PUT");
      assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
      assert.deepEqual(JSON.parse(init?.body as string), { type: "R1" });
      return json(summary);
    },
  });
  assert.deepEqual(await client.machine("m1").setType("R1"), summary);
});

test("setType accepts no content for a non-member account admin", async () => {
  const client = clientAnswering({ method: "PUT", path: "/v2/machines/m1/type" }, () => new Response(null, { status: 204 }));
  assert.equal(await client.machine("m1").setType("R1"), undefined);
});

test("setType still rejects an empty JSON response", async () => {
  const client = clientAnswering({ method: "PUT", path: "/v2/machines/m1/type" }, () => new Response(null, { status: 200 }));
  await assert.rejects(client.machine("m1").setType("R1"), SyntaxError);
});

test("setType still rejects permission failures", async () => {
  const client = clientAnswering({ method: "PUT", path: "/v2/machines/m1/type" }, () => json({
    type: "about:blank", title: "Forbidden", status: 403, code: "forbidden",
    detail: "You don't have permission to change this machine's hardware type.",
  }, 403));
  await assert.rejects(client.machine("m1").setType("R1"), { status: 403, code: "forbidden" });
});

test("getResources returns the reading as sent", async () => {
  const reading: MachineResources = {
    running: true,
    vcpus: 2,
    cpuBusySeconds: 12.5,
    uptimeSeconds: 300,
    memTotalBytes: 1_000_000,
    memAvailableBytes: 400_000,
  };
  const client = clientAnswering({ method: "GET", path: "/v2/machines/m1/resources" }, () => json(reading));
  assert.deepEqual(await client.machine("m1").getResources(), reading);
});

test("checkpoints.list unwraps the collection", async () => {
  const checkpoint = { id: "s1_a", createdAt: "2026-10-06T10:00:00.000Z", restoredFrom: null, preRestore: false };
  const client = clientAnswering({ method: "GET", path: "/v2/machines/m1/checkpoints" }, () => json({ checkpoints: [checkpoint] }));
  assert.deepEqual(await client.machine("m1").checkpoints.list(), [checkpoint]);
});

test("checkpoints.restore returns the new checkpoint and the replaced one", async () => {
  const restore: MachineCheckpointRestore = {
    checkpoint: { id: "s3_c", createdAt: "2026-10-06T11:00:00.000Z", restoredFrom: "2026-10-06T10:00:00.000Z", preRestore: false },
    replacedCheckpointId: "s2_b",
  };
  const client = clientAnswering({ method: "POST", path: "/v2/machines/m1/checkpoints/s1_a/restore" }, () => json(restore, 201));
  assert.deepEqual(await client.machine("m1").checkpoints.restore("s1_a"), restore);
});
