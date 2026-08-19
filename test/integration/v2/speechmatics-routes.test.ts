/**
 * Local integration test for the SDK Speechmatics token API.
 */

import assert from "node:assert/strict";
import type { SpeechmaticsToken } from "../../../src/index.js";
import { expectProblem } from "./assertions.js";
import { API_URL, createTestClient, runSmokeTest } from "./harness.js";

const client = createTestClient();
const unauthenticatedClient = createTestClient(null);

function assertSpeechmaticsToken(token: SpeechmaticsToken): void {
  assert.equal(typeof token.token, "string");
  assert.ok(token.token.length > 0, "token must not be empty");
  assert.equal(typeof token.expiresAt, "number");
  assert.equal(typeof token.ttl, "number");
  const payload = JSON.parse(
    Buffer.from(token.token.split(".")[1], "base64url").toString(),
  );
  assert.equal(token.expiresAt, payload.exp * 1000);
  assert.ok(token.expiresAt > Date.now(), "expiresAt should be in the future");
}

async function main(): Promise<void> {
  console.log(`[test API] ${API_URL}\n`);

  console.log("Checking authentication...");
  await expectProblem(
    () => unauthenticatedClient.getSpeechmaticsToken(),
    401,
    "authentication_required",
  );

  console.log("Rejecting an out-of-range TTL...");
  await expectProblem(
    () => client.getSpeechmaticsToken({ ttl: 10 }),
    400,
    "invalid_input",
  );

  console.log("Minting a short-lived Speechmatics token...");
  const token = await client.getSpeechmaticsToken({ ttl: 60 });
  assertSpeechmaticsToken(token);

  console.log("\n✅ SDK speechmatics smoke tests passed.");
}

runSmokeTest(main, async () => {});
