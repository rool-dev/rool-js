import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient, type MachineRunEvent } from "../src/index.js";

test("prompt starts a detached run and follow reads its current stream", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  let currentRun = true;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      const method = init?.method ?? "GET";
      requests.push({ method, path: url.pathname });

      if (url.pathname.endsWith("/agents/rool")) {
        return Response.json({ system: "" });
      }
      if (!url.pathname.endsWith("/conversations/chat/run")) {
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }
      if (method === "POST") return new Response(null, { status: 202 });
      if (!currentRun) return new Response(null, { status: 404 });

      currentRun = false;
      return new Response(
        [
          JSON.stringify({
            type: "output.delta",
            content: { type: "text", text: "Hello" },
          }),
          JSON.stringify({
            type: "output.delta",
            content: {
              type: "tool_call",
              id: "call_1",
              name: "exec_shell",
              arguments: { command: "printf result" },
            },
          }),
          JSON.stringify({
            type: "output.delta",
            content: {
              type: "tool_result",
              id: "call_1",
              content: [{ type: "text", text: "result" }],
            },
          }),
          JSON.stringify({ type: "completed", finish: "stop" }),
          "",
        ].join("\n"),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    },
  });

  const agent = await client.machine("machine").agents.get("rool");
  assert(agent);
  const conversation = agent.conversation("chat");

  await conversation.prompt("Say hello");

  assert.deepEqual(
    requests.map(({ method, path }) => ({ method, path })),
    [
      { method: "GET", path: "/v2/machines/machine/agents/rool" },
      {
        method: "POST",
        path: "/v2/machines/machine/agents/rool/conversations/chat/run",
      },
    ],
  );
  const events: MachineRunEvent[] = [];
  assert.equal(
    await conversation.follow({ onEvent: (event) => events.push(event) }),
    true,
  );
  assert.deepEqual(events, [
    {
      type: "output.delta",
      content: { type: "text", text: "Hello" },
    },
    {
      type: "output.delta",
      content: {
        type: "tool_call",
        id: "call_1",
        name: "exec_shell",
        arguments: { command: "printf result" },
      },
    },
    {
      type: "output.delta",
      content: {
        type: "tool_result",
        id: "call_1",
        content: [{ type: "text", text: "result" }],
      },
    },
    { type: "completed", finish: "stop" },
  ]);
  assert.equal(await conversation.follow(), false);
  assert.equal(requests.filter(({ method }) => method === "GET").length, 3);
});

test("watch catches up, follows the current run, and settles saved turns", async () => {
  const user = {
    id: "turn_user",
    createdAt: "2026-01-01T00:00:00.000Z",
    role: "user",
    content: [{ type: "text", text: "Hello" }],
  };
  const assistant = {
    id: "turn_assistant",
    createdAt: "2026-01-01T00:00:01.000Z",
    role: "assistant",
    content: [{ type: "text", text: "Hi" }],
    finish: "stop",
  };
  const turnRequests: string[] = [];
  let runSettled = false;

  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.pathname.endsWith("/agents/rool")) {
        return Response.json({ system: "" });
      }
      if (url.pathname === "/v2/session") {
        return Response.json({ accountSyncToken: "account-token" });
      }
      if (url.pathname === "/v2/events") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      if (url.pathname.endsWith("/conversations/chat/turns")) {
        turnRequests.push(`${url.pathname}${url.search}`);
        if (!url.searchParams.has("after")) {
          return Response.json({
            turns: [user],
            reset: true,
            isRunning: true,
          });
        }
        return Response.json({
          turns: runSettled ? [assistant] : [],
          reset: false,
          isRunning: !runSettled,
        });
      }
      if (url.pathname.endsWith("/conversations/chat/run")) {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    type: "output.delta",
                    content: { type: "text", text: "Hi" },
                  })}\n`,
                ),
              );
              setTimeout(() => {
                runSettled = true;
                controller.enqueue(
                  encoder.encode(
                    `${JSON.stringify({ type: "completed", finish: "stop" })}\n`,
                  ),
                );
                controller.close();
              }, 10);
            },
          }),
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      throw new Error(
        `Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
      );
    },
  });

  const agent = await client.machine("machine").agents.get("rool");
  assert(agent);
  const conversation = agent.conversation("chat");
  let sawOutput = false;
  let finish = () => {};
  const settled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = conversation.watch((view) => {
    sawOutput ||= view.output.some(
      (part) => part.type === "text" && part.text === "Hi",
    );
    if (
      !view.loading &&
      !view.isRunning &&
      view.turns.some((turn) => turn.id === "turn_assistant")
    ) {
      finish();
    }
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("watch did not settle")),
          2_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  stop();

  assert.equal(sawOutput, true);
  assert(
    turnRequests.some((path) => path.endsWith("?after=turn_user")),
    "watch did not request turns after its saved user turn",
  );
});

test("conversation instructions round-trip through their own resource", async () => {
  let savedInstructions = "";
  const instructionsPath =
    "/v2/machines/machine/agents/rool/conversations/chat/instructions";
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.pathname.endsWith("/agents/rool")) {
        return Response.json({ system: "" });
      }

      assert.equal(url.pathname, instructionsPath);
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          instructions: string;
        };
        savedInstructions = body.instructions.trim();
      } else {
        assert.equal(method, "GET");
      }
      return Response.json({ instructions: savedInstructions });
    },
  });

  const agent = await client.machine("machine").agents.get("rool");
  assert(agent);
  const conversation = agent.conversation("chat");

  assert.equal(await conversation.getInstructions(), "");
  assert.equal(
    await conversation.replaceInstructions("  Answer in French.\n"),
    "Answer in French.",
  );
  assert.equal(await conversation.getInstructions(), "Answer in French.");
  assert.equal(await conversation.replaceInstructions(""), "");
});

test("prompt sends run options", async () => {
  let runInput: unknown;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.pathname.endsWith("/agents/rool")) {
        return Response.json({ system: "" });
      }
      if (
        init?.method !== "POST" ||
        !url.pathname.endsWith("/conversations/chat/run")
      ) {
        throw new Error(
          `Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
        );
      }
      runInput = JSON.parse(String(init.body));
      return new Response(null, { status: 202 });
    },
  });

  const agent = await client.machine("machine").agents.get("rool");
  assert(agent);
  await agent.conversation("chat").prompt("Count the records", {
    effort: "quick",
    readOnly: true,
    responseSchema: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
  });

  assert.deepEqual(runInput, {
    content: [{ type: "text", text: "Count the records" }],
    effort: "quick",
    readOnly: true,
    responseSchema: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
  });
});
