import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoolEvents, type RoolClientEvent } from "../src/events.js";
import type { RoolSession } from "../src/types.js";

function session(syncToken: string): RoolSession {
  return {
    user: {
      id: "user-1",
      email: "user@example.com",
      photoUrl: null,
      totalCreditsUsed: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActivity: null,
    },
    accounts: [],
    syncToken,
    profile: { name: null, marketingOptIn: false },
    userAppData: {},
    machines: [],
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
          { type: "webdav_credentials_changed", machineId: "machine-1", timestamp: 1 },
          { type: "account_changed", accountId: "account-1", timestamp: 1 },
          { type: "profile_changed", timestamp: 2 },
          { type: "user_app_data_changed", timestamp: 3 },
          { type: "providers_changed", accountId: "account-1", timestamp: 3 },
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
            type: "mcp_connections_changed",
            machineId: "machine-1",
            timestamp: 6,
          },
          {
            type: "conversation_changed",
            machineId: "machine-1",
            agentId: "rool",
            conversationId: "conversation-1",
            timestamp: 7,
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
      if (received.length === 10) {
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
    { type: "webdav_credentials_changed", machineId: "machine-1", timestamp: 1 },
    { type: "account_changed", accountId: "account-1", timestamp: 1 },
    { type: "profile_changed", timestamp: 2 },
    { type: "user_app_data_changed", timestamp: 3 },
    { type: "providers_changed", accountId: "account-1", timestamp: 3 },
    { type: "machines_changed", machineId: "machine-1", timestamp: 4 },
    {
      type: "machine_members_changed",
      machineId: "machine-1",
      timestamp: 5,
    },
    {
      type: "mcp_connections_changed",
      machineId: "machine-1",
      timestamp: 6,
    },
    {
      type: "conversation_changed",
      machineId: "machine-1",
      agentId: "rool",
      conversationId: "conversation-1",
      timestamp: 7,
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
