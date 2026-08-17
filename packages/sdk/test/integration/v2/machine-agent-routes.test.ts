/**
 * Smoke test for agent JSON and run-stream routes through the SDK and local
 * machine router.
 */

import assert from "node:assert/strict";
import {
  RoolProblem,
  type MachineConversation,
  type MachineConversationContentPart,
  type MachineConversationPromptOptions,
  type MachineConversationTurn,
  type MachineRunEvent,
} from "../../../src/index.js";
import {
  createRoutedFetch,
  createTestClient,
  MachineCleanup,
  requireLocalRouter,
  runSmokeTest,
} from "./harness.js";

const routedFetch = createRoutedFetch();
const normalConversationId = `sdk-agent-${Date.now()}`;
const cancelledConversationId = `sdk-cancel-${Date.now()}`;
let runPosts = 0;
let runStreams = 0;
let runDeletes = 0;
let cancellationFollowStarted = () => {};
const cancellationFollowReady = new Promise<void>((resolve) => {
  cancellationFollowStarted = resolve;
});

const observingFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const isRun = /\/agents\/[^/]+\/conversations\/[^/]+\/run$/.test(
    url.pathname,
  );
  const response = await routedFetch(input, init);
  if (!isRun) return response;

  if (init?.method === "POST") {
    runPosts++;
  } else if (init?.method === "DELETE") {
    runDeletes++;
  } else if (response.status === 200) {
    assert(
      response.headers.get("Content-Type")?.startsWith("application/x-ndjson"),
    );
    runStreams++;
    if (url.pathname.includes(`/${cancelledConversationId}/run`)) {
      cancellationFollowStarted();
    }
  }
  return response;
};

const client = createTestClient("primary", observingFetch);
const machineCleanup = new MachineCleanup(client);

function contentText(parts: MachineConversationContentPart[]): string {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

function turnText(turn: MachineConversationTurn): string {
  return contentText(turn.content);
}

function assertIsoDate(value: string): void {
  assert.equal(new Date(value).toISOString(), value);
}

async function promptAndFollow(
  conversation: MachineConversation,
  text: string,
  options: MachineConversationPromptOptions,
  events: MachineRunEvent[] = [],
): Promise<{
  user: MachineConversationTurn;
  assistant: MachineConversationTurn;
}> {
  await conversation.prompt(text, options);
  assert.equal(
    await conversation.follow({ onEvent: (event) => events.push(event) }),
    true,
  );

  const turns = await conversation.listTurns();
  const user = [...turns].reverse().find((turn) => turn.role === "user");
  const assistant = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.finish !== "tool_calls");
  assert(user);
  assert(assistant);
  return { user, assistant };
}

async function main(): Promise<void> {
  await requireLocalRouter();

  const account = await client.getAccount();
  const created = machineCleanup.track(
    await client.createMachine({ name: `SDK agent routes ${Date.now()}` }),
  );
  const machine = client.machine(created.id);

  console.log("Reading the stock agent without watching files...");
  assert.equal(machine.files.isWatching, false);
  const stock = await machine.agents.get("rool");
  assert(stock);
  assert.deepEqual(stock.definition, { system: "" });
  assert.equal(
    (await machine.agents.list()).some((agent) => agent.id === "rool"),
    true,
  );

  console.log("Creating and replacing a custom agent through item PUT...");
  const customId = `custom-${Date.now()}`;
  const custom = await machine.agents.create(customId, {
    system: "Answer every request in one short sentence.",
  });
  assert.deepEqual(custom.definition, {
    system: "Answer every request in one short sentence.",
  });
  const replaced = await custom.replace({
    system: "Give direct and brief answers.",
  });
  assert.deepEqual(replaced.definition, {
    system: "Give direct and brief answers.",
  });

  console.log("Creating and replacing conversation metadata...");
  const explicit = await replaced.createConversation({
    id: `explicit-${Date.now()}`,
    name: "Explicit conversation",
    visibility: "private",
  });
  const initialConversation = await explicit.get();
  assert(initialConversation);
  assert.equal(initialConversation.name, "Explicit conversation");
  assert.equal(initialConversation.visibility, "private");
  assert.equal(initialConversation.isRunning, false);
  assert.deepEqual(initialConversation.turns, []);
  assertIsoDate(initialConversation.createdAt);
  assertIsoDate(initialConversation.updatedAt);
  assert.equal(await explicit.getInstructions(), "");
  const customInstructions = "Compare at least two sources.";
  assert.equal(
    await explicit.replaceInstructions(customInstructions),
    customInstructions,
  );
  await explicit.rename("Renamed conversation");
  assert.equal((await explicit.get())?.name, "Renamed conversation");
  await explicit.replace({ name: "Shared conversation", visibility: "shared" });
  assert.equal((await explicit.get())?.visibility, "shared");
  assert.equal(await explicit.getInstructions(), customInstructions);
  assert.equal(await explicit.replaceInstructions(""), "");
  const listedConversation = (await replaced.listConversations()).find(
    (conversation) => conversation.id === explicit.id,
  );
  assert(listedConversation);
  assert.equal(listedConversation.name, "Shared conversation");
  assert.equal(listedConversation.visibility, "shared");
  assert.equal(listedConversation.isRunning, false);
  assertIsoDate(listedConversation.createdAt);
  assertIsoDate(listedConversation.updatedAt);

  console.log("Starting a detached prompt and following its run stream...");
  const events: MachineRunEvent[] = [];
  const normal = stock.conversation(normalConversationId);
  const completed = await promptAndFollow(
    normal,
    "Without using tools, say hello in one sentence.",
    { effort: "quick" },
    events,
  );
  assert.equal(completed.user.userId, account.id);
  assert.equal(completed.user.role, "user");
  assert.equal(completed.assistant.role, "assistant");
  assert.notEqual(completed.assistant.finish, "tool_calls");
  assert(turnText(completed.assistant).length > 0);
  assert(events.some((event) => event.type === "completed"));
  assert.equal(machine.files.isWatching, false);

  console.log("Following matching tool calls and results...");
  const toolMarker = `sdk-tool-result-${Date.now()}`;
  const toolEvents: MachineRunEvent[] = [];
  await promptAndFollow(
    normal,
    `Use exec_shell exactly once to run printf ${toolMarker}. Then briefly report that it worked.`,
    { effort: "quick" },
    toolEvents,
  );
  const toolCall = toolEvents.find(
    (event) =>
      event.type === "output.delta" &&
      event.content.type === "tool_call" &&
      event.content.name === "exec_shell",
  );
  assert(toolCall?.type === "output.delta");
  assert(toolCall.content.type === "tool_call");
  const toolCallId = toolCall.content.id;
  const toolResult = toolEvents.find(
    (event) =>
      event.type === "output.delta" &&
      event.content.type === "tool_result" &&
      event.content.id === toolCallId,
  );
  assert(toolResult?.type === "output.delta");
  assert(toolResult.content.type === "tool_result");
  assert(contentText(toolResult.content.content).includes(toolMarker));

  console.log("Settling structured output as one JSON content part...");
  const structured = await replaced.createConversation({
    id: `structured-${Date.now()}`,
    visibility: "private",
  });
  const responseSchema = {
    type: "object",
    properties: { answer: { type: "integer" } },
    required: ["answer"],
    additionalProperties: false,
  };
  const structuredResult = await promptAndFollow(
    structured,
    "Return an object whose answer is the integer 7.",
    { effort: "quick", responseSchema },
  );
  assert.equal(structuredResult.assistant.content.length, 1);
  const structuredPart = structuredResult.assistant.content[0];
  assert.equal(structuredPart?.type, "json");
  if (structuredPart?.type !== "json") {
    throw new Error("Structured assistant turn did not contain JSON");
  }
  assert.deepEqual(structuredPart.value, { answer: 7 });

  console.log("Watching one conversation through catch-up and live output...");
  const watched = await stock.createConversation({
    id: `watched-${Date.now()}`,
    visibility: "private",
  });
  let watchedOutput = "";
  let finishWatch = () => {};
  const watchSettled = new Promise<void>((resolve) => {
    finishWatch = resolve;
  });
  const stopWatching = watched.watch((view) => {
    if (view.output.length > 0) {
      watchedOutput = contentText([...view.output]);
    }
    const settledAssistant = view.turns.find(
      (turn) => turn.role === "assistant" && turn.finish !== "tool_calls",
    );
    if (!view.loading && !view.isRunning && settledAssistant) finishWatch();
  });
  await watched.prompt("Without using tools, say watched in one sentence.", {
    effort: "quick",
  });
  let watchTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      watchSettled,
      new Promise<never>((_resolve, reject) => {
        watchTimeout = setTimeout(
          () => reject(new Error("conversation watch did not settle")),
          30_000,
        );
      }),
    ]);
  } finally {
    if (watchTimeout) clearTimeout(watchTimeout);
  }
  stopWatching();
  assert(watchedOutput.length > 0, "conversation watch omitted live output");

  console.log("Editing and rerolling through durable user turn IDs...");
  const original = await promptAndFollow(
    normal,
    "Without using tools, reply with the single word original.",
    { effort: "quick" },
  );
  const firstEdit = await promptAndFollow(
    normal,
    "Without using tools, reply with the single word first.",
    {
      effort: "quick",
      replaceTurnId: original.user.id,
    },
  );
  await assert.rejects(
    normal.prompt("This must not be appended.", {
      effort: "quick",
      replaceTurnId: original.user.id,
    }),
    (error) =>
      error instanceof RoolProblem &&
      error.status === 409 &&
      error.code === "replace_turn_not_found",
  );
  const secondEdit = await promptAndFollow(
    normal,
    "Without using tools, reply with the single word second.",
    {
      effort: "quick",
      replaceTurnId: firstEdit.user.id,
    },
  );
  const rerolled = await promptAndFollow(
    normal,
    "Without using tools, reply with the single word rerolled.",
    {
      effort: "quick",
      replaceTurnId: secondEdit.user.id,
    },
  );
  let editedTurns = await normal.listTurns();
  assert(editedTurns.some((turn) => turn.id === completed.user.id));
  assert.equal(
    editedTurns.some((turn) => turn.id === original.user.id),
    false,
  );
  assert.equal(
    editedTurns.some((turn) => turn.id === firstEdit.user.id),
    false,
  );
  assert.equal(
    editedTurns.some((turn) => turn.id === secondEdit.user.id),
    false,
  );
  assert.equal(
    editedTurns.some((turn) => turn.id === rerolled.user.id),
    true,
  );

  console.log("Replacing the first user turn...");
  const rootEdit = await promptAndFollow(
    normal,
    "Without using tools, reply with the single word root.",
    {
      effort: "quick",
      replaceTurnId: completed.user.id,
    },
  );
  editedTurns = await normal.listTurns();
  assert.equal(editedTurns[0]?.id, rootEdit.user.id);
  assert.equal(
    editedTurns.some((turn) => turn.id === completed.user.id),
    false,
  );

  console.log("Cancelling a followed run through DELETE on its fixed path...");
  const cancelling = stock.conversation(cancelledConversationId);
  const cancelledEvents: MachineRunEvent[] = [];
  await cancelling.prompt(
    "Without using tools, write a detailed 2,000 word essay about ocean currents.",
    { effort: "quick" },
  );
  assert.equal((await cancelling.get())?.isRunning, true);
  assert.equal(
    (await stock.listConversations()).find(
      (conversation) => conversation.id === cancelledConversationId,
    )?.isRunning,
    true,
  );
  await assert.rejects(
    cancelling.prompt("This concurrent prompt must be rejected.", {
      effort: "quick",
    }),
    (error) =>
      error instanceof RoolProblem &&
      error.status === 409 &&
      error.code === "current_run_exists",
  );
  const cancelledFollow = cancelling.follow({
    onEvent: (event) => cancelledEvents.push(event),
  });
  await cancellationFollowReady;
  assert.equal(await cancelling.cancel(), true);
  assert.equal(await cancelledFollow, true);
  const cancelledTurns = await cancelling.listTurns();
  const cancelledAssistant = [...cancelledTurns]
    .reverse()
    .find((turn) => turn.role === "assistant");
  assert.equal(cancelledAssistant?.finish, "cancelled");
  assert(cancelledEvents.some((event) => event.type === "cancelled"));
  assert.equal((await cancelling.get())?.isRunning, false);
  assert.equal(
    (await stock.listConversations()).find(
      (conversation) => conversation.id === cancelledConversationId,
    )?.isRunning,
    false,
  );
  assert.equal(await cancelling.cancel(), false);

  await explicit.delete();
  assert.equal(await explicit.get(), undefined);
  await watched.delete();
  await structured.delete();
  await replaced.delete();
  assert.equal(await machine.agents.get(customId), undefined);

  assert.equal(runPosts, 12);
  assert.equal(runStreams, 10);
  assert.equal(runDeletes, 2);

  console.log("\n✅ SDK agent route smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
