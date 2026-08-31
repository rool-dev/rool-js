import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoolEvents, type RoolClientEvent } from "../src/events.js";
import type { RoolSession } from "../src/types.js";

function session(accountSyncToken: string): RoolSession {
  return {
    account: {
      id: "user-1",
      email: "user@example.com",
      photoUrl: null,
      plan: "standard",
      creditsBalance: 0,
      totalCreditsUsed: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActivity: null,
      processedAt: "2026-01-01T00:00:00.000Z",
      stripeStatus: null,
    },
    profile: { name: null, marketingOptIn: false },
    userAppData: {},
    machines: [],
    accountSyncToken,
    server: {
      version: "test",
      minimumSdkVersion: "0.0.0",
      compatibility: "ok",
    },
  };
}

test("empty polls and network retries do not refresh the session", async () => {
  const initialSession = session("token-0");
  const requestedTokens: string[] = [];
  let polls = 0;
  let sessionRequests = 0;
  const events = createRoolEvents({
    poll: async (syncToken) => {
      requestedTokens.push(syncToken);
      polls++;
      if (polls === 1) {
        return Response.json({ syncToken, events: [] });
      }
      if (polls === 2) throw new Error("network down");
      if (polls === 3) {
        return Response.json({ syncToken: "token-1", events: [] });
      }
      return Response.json({
        syncToken: "token-2",
        events: [
          { type: "account_changed", timestamp: 1 },
          { type: "profile_changed", timestamp: 2 },
          { type: "user_app_data_changed", timestamp: 3 },
          { type: "providers_changed", timestamp: 3 },
          {
            type: "machines_changed",
            machineId: "machine-1",
            timestamp: 4,
          },
          {
            type: "machine_members_changed",
            machineId: "machine-1",
            timestamp: 5,
          },
          {
            type: "conversation_changed",
            machineId: "machine-1",
            agentId: "rool",
            conversationId: "conversation-1",
            timestamp: 6,
          },
        ],
      });
    },
    getSession: async () => {
      sessionRequests++;
      return initialSession;
    },
  });

  const received: RoolClientEvent[] = [];
  const complete = new Promise<void>((resolve) => {
    const unsubscribe = events.subscribe((event) => {
      received.push(event);
      if (received.length === 8) {
        unsubscribe();
        resolve();
      }
    });
  });
  await complete;

  assert.equal(sessionRequests, 1);
  assert.deepEqual(requestedTokens, [
    "token-0",
    "token-0",
    "token-0",
    "token-1",
  ]);
  assert.deepEqual(received, [
    { type: "session", session: initialSession },
    { type: "account_changed", timestamp: 1 },
    { type: "profile_changed", timestamp: 2 },
    { type: "user_app_data_changed", timestamp: 3 },
    { type: "providers_changed", timestamp: 3 },
    { type: "machines_changed", machineId: "machine-1", timestamp: 4 },
    {
      type: "machine_members_changed",
      machineId: "machine-1",
      timestamp: 5,
    },
    {
      type: "conversation_changed",
      machineId: "machine-1",
      agentId: "rool",
      conversationId: "conversation-1",
      timestamp: 6,
    },
  ]);
  assert.equal(events.error, null);
});

test("an invalid token fetches a new session", async () => {
  const sessions = [session("expired"), session("fresh")];
  let polls = 0;
  const events = createRoolEvents({
    poll: async (syncToken) => {
      polls++;
      if (polls === 1) {
        assert.equal(syncToken, "expired");
        return new Response(null, { status: 409 });
      }
      assert.equal(syncToken, "fresh");
      return Response.json({
        syncToken: "next",
        events: [{ type: "user_app_data_changed", timestamp: 1 }],
      });
    },
    getSession: async () => {
      const next = sessions.shift();
      if (!next) throw new Error("Unexpected session request");
      return next;
    },
  });

  const received: RoolClientEvent[] = [];
  const complete = new Promise<void>((resolve) => {
    const unsubscribe = events.subscribe((event) => {
      received.push(event);
      if (event.type === "user_app_data_changed") {
        unsubscribe();
        resolve();
      }
    });
  });
  await complete;

  assert.deepEqual(
    received.map((event) => event.type),
    ["session", "session", "user_app_data_changed"],
  );
});
