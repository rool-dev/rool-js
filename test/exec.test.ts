import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoolClient,
  RoolProblem,
  type MachineExecOptions,
  type MachineExecResult,
} from "../src/index.js";

test("exec sends an authenticated command with stdin and options without serializing the signal", async () => {
  const controller = new AbortController();
  const options: MachineExecOptions = {
    command: "cd /rool-drive\nprintf '%s\\n' 'café & $HOME'\ncat",
    stdin: "input\nwith Unicode: 李",
    timeoutMs: 12_000,
    asUserId: "member-id",
    signal: controller.signal,
  };
  const result: MachineExecResult = {
    exitCode: 0,
    stdout: "café & $HOME\ninput\nwith Unicode: 李",
    stderr: "",
    durationMs: 23,
  };
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    getTokens: async () => ({
      accessToken: "test-access",
      roolToken: "test-rool",
    }),
    fetch: async (input, init) => {
      assert.equal(
        String(input),
        "https://api.example.test/v2/machines/test%2Fmachine/exec",
      );
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.equal(headers.get("Authorization"), "Bearer test-access");
      assert.equal(headers.get("X-Rool-Token"), "test-rool");
      assert.equal(init?.signal, controller.signal);
      const { signal: _, ...body } = options;
      assert.deepEqual(JSON.parse(String(init?.body)), body);
      return Response.json(result);
    },
  });
  assert.deepEqual(await client.machine("test/machine").exec(options), result);
});

test("exec uses server defaults and returns nonzero exit codes with both output streams", async () => {
  const result = {
    exitCode: 7,
    stdout: "partial output\n",
    stderr: "failed\n",
    durationMs: 42,
  };
  const client = new RoolClient({
    fetch: async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { command: "exit 7" });
      return Response.json(result);
    },
  });
  assert.deepEqual(
    await client.machine("test").exec({ command: "exit 7" }),
    result,
  );
});

test("exec preserves permission and validation failures as API problems", async () => {
  for (const [status, code] of [
    [403, "forbidden"],
    [400, "invalid_exec_request"],
  ] as const) {
    const client = new RoolClient({
      fetch: async () =>
        Response.json(
          { type: "about:blank", title: code, status, code },
          { status },
        ),
    });
    await assert.rejects(
      client.machine("test").exec({ command: "id" }),
      (error: unknown) =>
        error instanceof RoolProblem &&
        error.status === status &&
        error.code === code,
    );
  }
});

test("exec never sends an already aborted command", async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const client = new RoolClient({
    fetch: async () => {
      requests++;
      return Response.json({});
    },
  });
  await assert.rejects(
    client.machine("test").exec({ command: "id", signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(requests, 0);
});

test("exec does not retry an ambiguous network failure", async () => {
  let requests = 0;
  const failure = new TypeError("Connection lost");
  const client = new RoolClient({
    fetch: async () => {
      requests++;
      throw failure;
    },
  });
  await assert.rejects(
    client
      .machine("test")
      .exec({ command: "echo item >> /rool-drive/items.txt" }),
    (error) => error === failure,
  );
  assert.equal(requests, 1);
});
