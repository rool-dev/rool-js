/**
 * Local integration test for the SDK gift API.
 */

import assert from "node:assert/strict";
import { RoolClient, roolSdkVersion, type Gift } from "../../../src/index.js";
import { assertIsoDate, expectProblem } from "./assertions.js";
import { createTestClient, runSmokeTest } from "./harness.js";

const holderEmail = requiredEnvironment("ROOL_TEST_GIFT_HOLDER_EMAIL");
const claimantEmail = requiredEnvironment("ROOL_TEST_GIFT_CLAIMANT_EMAIL");
const internalSecret = requiredEnvironment("ROOL_TEST_INTERNAL_SECRET");
const holderClient = createLocalClient(holderEmail);
const claimantClient = createLocalClient(claimantEmail);
const publicClient = createTestClient(null);
const userIdsToDelete = new Set<string>();

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createLocalClient(email: string): RoolClient {
  return new RoolClient({
    apiUrl: requiredEnvironment("ROOL_TEST_API_URL"),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Rool-SDK-Name"), "@rool-dev/sdk");
      assert.equal(headers.get("X-Rool-SDK-Version"), roolSdkVersion);
      assert.equal(headers.has("Authorization"), false);
      headers.set("X-Dev-User", email);
      return fetch(input, { ...init, headers });
    },
  });
}

function assertGift(gift: Gift): void {
  assert.deepEqual(Object.keys(gift).sort(), [
    "archivedAt",
    "claimedAt",
    "claimedByName",
    "code",
    "createdAt",
    "description",
    "gift",
    "id",
    "note",
    "url",
  ]);
  assert.match(gift.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assertIsoDate(gift.createdAt);
}

async function main(): Promise<void> {
  const apiUrl = requiredEnvironment("ROOL_TEST_API_URL");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(apiUrl).hostname)) {
    throw new Error("SDK gift smoke tests only run against a local backend");
  }

  const holder = await holderClient.getAccount();
  const claimantBefore = await claimantClient.getAccount();
  userIdsToDelete.add(holder.id);
  userIdsToDelete.add(claimantBefore.id);

  console.log("Issuing a gift fixture...");
  const response = await fetch(`${apiUrl}/internal/issue-gifts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret,
    },
    body: JSON.stringify({
      userId: holder.id,
      count: 1,
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const issued = (JSON.parse(body) as { gifts: Array<{ giftId: string }> })
    .gifts[0];

  console.log("Listing and previewing the gift through the SDK...");
  const gift = (await holderClient.listGifts()).gifts.find(
    (item) => item.id === issued.giftId,
  );
  assert(gift);
  assertGift(gift);
  assert.deepEqual(gift.gift, { kind: "credits", credits: 10_000 });
  assert.equal(gift.description, "10,000 AI credits");
  assert.equal(gift.claimedAt, null);

  const preview = await publicClient.previewGift(gift.code);
  assert.deepEqual(preview.gift, gift.gift);
  assert.equal(preview.description, gift.description);

  console.log("Updating and rotating the gift through the SDK...");
  const updated = await holderClient.updateGift(gift.id, {
    note: "sent by the SDK smoke test",
    archived: true,
  });
  assertGift(updated);
  assert.equal(updated.note, "sent by the SDK smoke test");
  assert(updated.archivedAt);

  const rotated = await holderClient.rotateGiftCode(gift.id);
  assertGift(rotated);
  assert.notEqual(rotated.code, gift.code);
  await expectProblem(
    () => publicClient.previewGift(gift.code),
    404,
    "gift_invalid",
  );

  console.log("Claiming the gift through the SDK...");
  const claim = await claimantClient.claimGift(rotated.code);
  assert.deepEqual(claim.gift, gift.gift);
  assert.equal(claim.description, gift.description);

  const claimantAfter = await claimantClient.getAccount();
  assert.equal(
    claimantAfter.creditsBalance,
    claimantBefore.creditsBalance + gift.gift.credits,
  );

  const claimed = (await holderClient.listGifts()).gifts.find(
    (item) => item.id === gift.id,
  );
  assert(claimed?.claimedAt);
  await expectProblem(
    () => claimantClient.claimGift(rotated.code),
    410,
    "gift_claimed",
  );
  await expectProblem(
    () => holderClient.rotateGiftCode(gift.id),
    410,
    "gift_claimed",
  );

  console.log("\n✅ SDK gift route smoke tests passed.");
}

async function cleanup(): Promise<void> {
  const apiUrl = requiredEnvironment("ROOL_TEST_API_URL");
  for (const userId of userIdsToDelete) {
    const response = await fetch(`${apiUrl}/internal/delete-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": internalSecret,
      },
      body: JSON.stringify({ userId }),
    });
    assert.equal(response.status, 200, await response.text());
    userIdsToDelete.delete(userId);
  }
}

runSmokeTest(main, cleanup);
