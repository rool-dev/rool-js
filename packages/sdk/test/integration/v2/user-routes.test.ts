/**
 * Smoke test for the SDK session and user API.
 *
 * Runs against an explicitly configured non-production account because it
 * replaces profile and user app data and exercises account deletion.
 *
 * Required environment:
 *   ROOL_TEST_API_URL
 *   ROOL_TEST_AUTH_URL when the API targets loopback
 *   ROOL_TEST_USER_ID
 */

import assert from "node:assert/strict";
import type {
  RoolSession,
  UserAccount,
  UserAppData,
  UserProfile,
} from "../../../src/index.js";
import {
  assertIsoDate,
  assertMachineSummary,
  expectProblem,
} from "./assertions.js";
import { API_URL, createTestClient, runSmokeTest } from "./harness.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateTestApiUrl(): void {
  requiredEnvironment("ROOL_TEST_API_URL");
  const url = new URL(API_URL);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const isSecure = url.protocol === "https:";
  const isLoopbackHttp =
    url.protocol === "http:" && loopbackHosts.has(url.hostname);

  if (!isSecure && !isLoopbackHttp) {
    throw new Error(
      "ROOL_TEST_API_URL must use HTTPS unless it targets loopback",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "ROOL_TEST_API_URL must not contain credentials, a query, or a fragment",
    );
  }
}

validateTestApiUrl();
const EXPECTED_USER_ID = requiredEnvironment("ROOL_TEST_USER_ID");
const USER_APP_DATA_KEYS = [
  "__sdk_user_app_data_smoke_a__",
  "__sdk_user_app_data_smoke_b__",
] as const;
const client = createTestClient();
const unauthenticatedClient = createTestClient(null);

let originalProfile: UserProfile | null = null;
let originalUserAppData: UserAppData | null = null;
let deletionRequested = false;

function assertAccount(account: UserAccount): void {
  assert.equal(typeof account.id, "string");
  assert.equal(typeof account.email, "string");
  assert(account.photoUrl === null || typeof account.photoUrl === "string");
  assert(["standard", "pro", "max", "admin"].includes(account.plan));
  assert.equal(typeof account.creditsBalance, "number");
  assert.equal(typeof account.totalCreditsUsed, "number");
  assertIsoDate(account.createdAt, "account.createdAt");
  if (account.lastActivity !== null) {
    assertIsoDate(account.lastActivity, "account.lastActivity");
  }
  assertIsoDate(account.processedAt, "account.processedAt");
  assert(
    account.stripeStatus === null || typeof account.stripeStatus === "string",
  );
}

async function main(): Promise<void> {
  console.log(`[test API] ${API_URL}\n`);

  console.log("Checking authentication...");
  await expectProblem(
    () => unauthenticatedClient.getAccount(),
    401,
    "authentication_required",
  );

  console.log("Reading the account, profile, user app data, and session...");
  const account = await client.getAccount();
  assertAccount(account);
  if (account.id !== EXPECTED_USER_ID) {
    throw new Error("Authenticated account does not match ROOL_TEST_USER_ID");
  }

  const profile = await client.getProfile();
  assert.deepEqual(Object.keys(profile).sort(), ["marketingOptIn", "name"]);
  originalProfile = profile;

  const userAppData = await client.getUserAppData();
  assert(
    userAppData !== null &&
      typeof userAppData === "object" &&
      !Array.isArray(userAppData),
  );
  originalUserAppData = userAppData;

  const session: RoolSession = await client.getSession();
  assert.deepEqual(session.account, account);
  assert.deepEqual(session.profile, profile);
  assert.deepEqual(session.userAppData, userAppData);
  assert(Array.isArray(session.machines));
  session.machines.forEach(assertMachineSummary);
  assert(session.accountSyncToken);
  assert(session.server.version);
  assert(session.server.minimumSdkVersion);
  assert.equal(session.server.compatibility, "ok");

  console.log("Replacing and validating the profile...");
  const replacementProfile: UserProfile = {
    ...profile,
    name: `SDK user routes smoke ${Date.now()}`,
  };
  assert.deepEqual(
    await client.replaceProfile(replacementProfile),
    replacementProfile,
  );
  assert.deepEqual(await client.getProfile(), replacementProfile);

  await expectProblem(
    () =>
      client.replaceProfile({
        name: replacementProfile.name,
      } as UserProfile),
    400,
    "invalid_profile",
  );

  console.log("Setting and validating user app data keys...");
  const values = [
    { ranAt: new Date().toISOString() },
    `concurrent-${Date.now()}`,
  ];
  await Promise.all(
    USER_APP_DATA_KEYS.map((key, index) =>
      client.setUserAppData(key, values[index]),
    ),
  );
  const updatedUserAppData = await client.getUserAppData();
  USER_APP_DATA_KEYS.forEach((key, index) => {
    assert.deepEqual(updatedUserAppData[key], values[index]);
  });

  await expectProblem(
    () =>
      client.setUserAppData(
        USER_APP_DATA_KEYS[0],
        "x".repeat(10 * 1024 * 1024),
      ),
    413,
    "user_app_data_too_large",
  );

  console.log("Reading the localized greeting...");
  const greeting = await client.getGreeting("en");
  assert(greeting.title);
  assert(greeting.text.startsWith("## "));

  console.log("Scheduling and cancelling account deletion...");
  await client.deleteAccount();
  deletionRequested = true;
  const restoredAccount = await client.getAccount();
  deletionRequested = false;
  assertAccount(restoredAccount);
  assert.equal(restoredAccount.id, account.id);

  console.log("\n✅ SDK user route smoke tests passed.");
}

async function cleanup(): Promise<void> {
  if (!originalProfile && !originalUserAppData && !deletionRequested) return;
  console.log("\nRestoring the local test user...");

  if (deletionRequested) {
    await client.getAccount();
    deletionRequested = false;
  }
  if (originalProfile) await client.replaceProfile(originalProfile);
  if (originalUserAppData) {
    for (const key of USER_APP_DATA_KEYS) {
      if (Object.hasOwn(originalUserAppData, key)) {
        await client.setUserAppData(key, originalUserAppData[key]);
      } else {
        await client.deleteUserAppData(key);
      }
    }
  }
}

runSmokeTest(main, cleanup);
