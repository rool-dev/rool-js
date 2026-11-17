import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient, RoolProblem } from "../src/index.js";

const metadata = {
  name: "Research",
  visibility: "private" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isRunning: false,
};

function setup(respond: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      requests.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return respond(url.pathname, init);
    },
  });
  return { machine: client.machine("machine"), requests };
}

test("machine conversation handles are lazy, cached and validate IDs", () => {
  const { machine, requests } = setup(() => { throw new Error("Unexpected request"); });
  const conversation = machine.conversation("chat");
  assert.equal(conversation.id, "chat");
  assert.equal(conversation.machineId, "machine");
  assert.equal(machine.conversation("chat"), conversation);
  assert.throws(() => machine.conversation("../bad"), /conversationId/);
  assert.deepEqual(requests, []);
});

test("create, list, get and delete conversations use machine routes", async () => {
  let deleted = false;
  const { machine, requests } = setup((path, init) => {
    if (init?.method === "DELETE") {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    if (deleted) return new Response(null, { status: 404 });
    if (path.endsWith("/turns")) return Response.json({ turns: [], reset: true, isRunning: false });
    if (path.endsWith("/conversations")) return Response.json({ conversations: { chat: metadata } });
    assert.equal(path, "/v2/machines/machine/conversations/chat");
    return Response.json(metadata);
  });
  const conversation = await machine.createConversation({ id: "chat", name: "Research" });
  assert.equal(conversation, machine.conversation("chat"));
  assert.deepEqual(requests[0], {
    path: "/v2/machines/machine/conversations/chat",
    method: "PUT",
    body: { name: "Research", visibility: "private" },
  });
  assert.deepEqual(await machine.listConversations(), [{ id: "chat", ...metadata }]);
  assert.deepEqual(await conversation.get(), { ...metadata, turns: [] });
  await conversation.delete();
  assert.equal(await conversation.get(), undefined);
  assert.notEqual(machine.conversation("chat"), conversation);
});

test("machine.prompt creates a private conversation and returns at acceptance without following", async () => {
  const { machine, requests } = setup((_path, init) => init?.method === "POST"
    ? new Response(null, { status: 202 })
    : Response.json(metadata));
  const chat = await machine.prompt("Hello", {
    model: "rool-1",
    effort: "standard",
    attachments: ["/rool-drive/report.pdf"],
  });
  assert.equal(chat.machineId, machine.id);
  assert.equal(chat, machine.conversation(chat.id));
  assert.match(chat.id, /^[A-Za-z0-9-]+$/);
  assert.deepEqual(requests, [
    { path: `/v2/machines/machine/conversations/${chat.id}`, method: "PUT", body: { visibility: "private" } },
    { path: `/v2/machines/machine/conversations/${chat.id}/run`, method: "POST", body: {
      content: [{ type: "text", text: "Hello" }, { type: "attachment", path: "/rool-drive/report.pdf" }],
      model: "rool-1",
      effort: "standard",
    } },
  ]);
});

test("machine.prompt accepts explicit creation options and propagates failures without deleting history", async () => {
  const { machine, requests } = setup((_path, init) => init?.method === "POST"
    ? Response.json({ type: "about:blank", title: "Busy", status: 409, code: "current_run_exists" }, { status: 409 })
    : Response.json(metadata));
  await assert.rejects(machine.prompt("Hello", { id: "chat", name: "Research", visibility: "shared" }),
    (error) => error instanceof RoolProblem && error.status === 409);
  assert.deepEqual(requests.map((request) => request.method), ["PUT", "POST"]);
  assert.deepEqual(requests[0]?.body, { name: "Research", visibility: "shared" });
});

test("conversation run cancellation returns false when no run exists", async () => {
  const { machine, requests } = setup(() => new Response(null, { status: 404 }));
  assert.equal(await machine.conversation("chat").cancel(), false);
  assert.deepEqual(requests, [{ path: "/v2/machines/machine/conversations/chat/run", method: "DELETE", body: undefined }]);
});

test("explicit creation can prepare instructions before prompting", async () => {
  const { machine, requests } = setup((path, init) => {
    if (path.endsWith("/instructions")) return Response.json({ instructions: "Be brief" });
    if (init?.method === "POST") return new Response(null, { status: 202 });
    return Response.json(metadata);
  });
  const chat = await machine.createConversation({ id: "chat", visibility: "shared" });
  await chat.replaceInstructions("Be brief");
  await chat.prompt("Hello", { replaceTurnId: "turn_old", responseSchema: { type: "object" } });
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    "PUT /v2/machines/machine/conversations/chat",
    "PUT /v2/machines/machine/conversations/chat/instructions",
    "POST /v2/machines/machine/conversations/chat/run",
  ]);
  assert.deepEqual(requests[2]?.body, {
    content: [{ type: "text", text: "Hello" }],
    replaceTurnId: "turn_old",
    responseSchema: { type: "object" },
  });
});
