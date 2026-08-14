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
