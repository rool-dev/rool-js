/**
 * Local integration test for the SDK voucher API.
 */

import assert from "node:assert/strict";
import { RoolClient, roolSdkVersion, type Voucher } from "../../../src/index.js";
import { assertIsoDate, expectProblem } from "./assertions.js";
import { createTestClient, runSmokeTest } from "./harness.js";

const holderEmail = requiredEnvironment("ROOL_TEST_VOUCHER_HOLDER_EMAIL");
const claimantEmail = requiredEnvironment("ROOL_TEST_VOUCHER_CLAIMANT_EMAIL");
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

function assertVoucher(voucher: Voucher): void {
  assert.deepEqual(Object.keys(voucher).sort(), [
    "archivedAt",
    "claimedAt",
    "claimedByName",
    "code",
    "createdAt",
    "description",
    "expiresAt",
    "id",
    "note",
    "url",
    "voucher",
  ]);
  assert.match(voucher.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assertIsoDate(voucher.createdAt);
  if (voucher.expiresAt !== null) assertIsoDate(voucher.expiresAt);
}

async function main(): Promise<void> {
  const apiUrl = requiredEnvironment("ROOL_TEST_API_URL");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(apiUrl).hostname)) {
    throw new Error("SDK voucher smoke tests only run against a local backend");
  }

  const holder = await holderClient.getAccount();
  const claimantBefore = await claimantClient.getAccount();
  userIdsToDelete.add(holder.id);
  userIdsToDelete.add(claimantBefore.id);

  console.log("Issuing a voucher fixture...");
  const response = await fetch(`${apiUrl}/internal/issue-vouchers`, {
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
  const issued = (
    JSON.parse(body) as { vouchers: Array<{ voucherId: string }> }
  ).vouchers[0];

  console.log("Listing and previewing the voucher through the SDK...");
  const voucher = (await holderClient.listVouchers()).vouchers.find(
    (item) => item.id === issued.voucherId,
  );
  assert(voucher);
  assertVoucher(voucher);
  assert.deepEqual(voucher.voucher, { kind: "credits", credits: 2_500 });
  assert.equal(voucher.description, "2,500 AI credits");
  assert.equal(voucher.claimedAt, null);

  const preview = await publicClient.previewVoucher(voucher.code);
  assert.deepEqual(preview.voucher, voucher.voucher);
  assert.equal(preview.description, voucher.description);

  console.log("Updating and rotating the voucher through the SDK...");
  const updated = await holderClient.updateVoucher(voucher.id, {
    note: "sent by the SDK smoke test",
    archived: true,
  });
  assertVoucher(updated);
  assert.equal(updated.note, "sent by the SDK smoke test");
  assert(updated.archivedAt);

  const rotated = await holderClient.rotateVoucherCode(voucher.id);
  assertVoucher(rotated);
  assert.notEqual(rotated.code, voucher.code);
  await expectProblem(
    () => publicClient.previewVoucher(voucher.code),
    404,
    "voucher_invalid",
  );

  console.log("Claiming the voucher through the SDK...");
  const claim = await claimantClient.claimVoucher(rotated.code);
  assert.deepEqual(claim.voucher, voucher.voucher);
  assert.equal(claim.description, voucher.description);

  const claimantAfter = await claimantClient.getAccount();
  assert.equal(
    claimantAfter.creditsBalance,
    claimantBefore.creditsBalance + voucher.voucher.credits,
  );

  const claimed = (await holderClient.listVouchers()).vouchers.find(
    (item) => item.id === voucher.id,
  );
  assert(claimed?.claimedAt);
  await expectProblem(
    () => claimantClient.claimVoucher(rotated.code),
    410,
    "voucher_claimed",
  );
  await expectProblem(
    () => holderClient.rotateVoucherCode(voucher.id),
    410,
    "voucher_claimed",
  );

  console.log("\n✅ SDK voucher route smoke tests passed.");
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
