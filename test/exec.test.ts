import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoolClient,
  RoolProblem,
  type MachineExecEvent,
  type MachineExecOptions,
  type MachineExecResult,
} from "../src/index.js";

// The exec route's reply: frames of [kind][length][payload]; 1 stdout, 2 stderr, 3 error, 4 exit.
function frame(kind: number, payload: string | Uint8Array): Uint8Array {
  const body =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const bytes = new Uint8Array(5 + body.length);
  bytes[0] = kind;
  new DataView(bytes.buffer).setUint32(1, body.length);
  bytes.set(body, 5);
  return bytes;
}

function exit(
  exitCode: number,
  durationMs: number,
  stdoutBytes: number,
  stderrBytes: number,
): Uint8Array {
  return frame(
    4,
    JSON.stringify({ exitCode, durationMs, stdoutBytes, stderrBytes }),
  );
}

// One HTTP body made of the given network chunks, so a test can split a frame across two.
function reply(...chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/vnd.rool.exec-stream" } },
  );
}

function replyTo(result: MachineExecResult): Response {
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  return reply(
    frame(1, result.stdout),
    frame(2, result.stderr),
    exit(
      result.exitCode,
      result.durationMs,
      bytes(result.stdout),
      bytes(result.stderr),
    ),
  );
}

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
      assert.equal(headers.get("Accept"), "application/vnd.rool.exec-stream");
      assert.equal(headers.get("Authorization"), "Bearer test-access");
      assert.equal(headers.get("X-Rool-Token"), "test-rool");
      assert.equal(init?.signal, controller.signal);
      const { signal: _, ...body } = options;
      assert.deepEqual(JSON.parse(String(init?.body)), body);
      return replyTo(result);
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
      return replyTo(result);
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

test("execStream gives the output as it comes, as bytes, and the exit last", async () => {
  const binary = new Uint8Array([0, 255, 254, 10]);
  const whole = [
    frame(1, "one\n"),
    frame(2, "warn\n"),
    frame(1, binary),
    exit(3, 9, 8, 5),
  ];
  const joined = new Uint8Array(whole.reduce((n, f) => n + f.length, 0));
  whole.reduce((at, f) => (joined.set(f, at), at + f.length), 0);
  // Cut in the middle of a header and in the middle of a payload.
  const client = new RoolClient({
    fetch: async () =>
      reply(joined.slice(0, 3), joined.slice(3, 12), joined.slice(12)),
  });
  const events: MachineExecEvent[] = [];
  for await (const event of client.machine("test").execStream({ command: "x" }))
    events.push(event);
  assert.deepEqual(events, [
    { type: "stdout", data: new TextEncoder().encode("one\n") },
    { type: "stderr", data: new TextEncoder().encode("warn\n") },
    { type: "stdout", data: binary },
    { type: "exit", exitCode: 3, durationMs: 9 },
  ]);
});

test("a command the machine cut off says why on stderr and exits -1", async () => {
  const client = new RoolClient({
    fetch: async () =>
      reply(
        frame(1, "partial"),
        frame(3, "command timed out after 30.0s"),
        exit(-1, 30_000, 7, 0),
      ),
  });
  assert.deepEqual(await client.machine("test").exec({ command: "sleep 60" }), {
    exitCode: -1,
    stdout: "partial",
    stderr: "command timed out after 30.0s\n",
    durationMs: 30_000,
  });
});

test("a command that could not run rejects with the reason", async () => {
  const client = new RoolClient({
    fetch: async () => reply(frame(3, "spawn failed: no such file")),
  });
  await assert.rejects(
    client.machine("test").exec({ command: "x" }),
    /spawn failed: no such file/,
  );
});

test("a reply that ends before the exit, or lost output on the way, rejects", async () => {
  const cut = new RoolClient({ fetch: async () => reply(frame(1, "half")) });
  await assert.rejects(
    cut.machine("test").exec({ command: "x" }),
    /ended before its exit/,
  );
  const lost = new RoolClient({
    fetch: async () => reply(frame(1, "half"), exit(0, 1, 400, 0)),
  });
  await assert.rejects(
    lost.machine("test").exec({ command: "x" }),
    /output was lost/,
  );
});
