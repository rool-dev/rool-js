/**
 * Local integration test for the SDK session and user API.
 */

import assert from "node:assert/strict";
import type {
  RoolSession,
  RoolAccount,
  RoolUser,
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

function assertUser(user: RoolUser): void {
  assert.equal(typeof user.id, "string");
  assert.equal(typeof user.email, "string");
  assert(user.photoUrl === null || typeof user.photoUrl === "string");
  assert.equal(typeof user.totalCreditsUsed, "number");
  assertIsoDate(user.createdAt, "user.createdAt");
  if (user.lastActivity !== null) {
    assertIsoDate(user.lastActivity, "user.lastActivity");
  }
}

function assertAccount(account: RoolAccount): void {
  assert.equal(typeof account.id, "string");
  assert.equal(typeof account.home, "boolean");
  assert(["admin", "member"].includes(account.role));
  assert(["standard", "plus", "pro", "team"].includes(account.plan));
  assert.equal(typeof account.balanceUsd, "number");
  assert.equal(typeof account.balanceCredits, "number");
  if (account.compedUntil !== null)
    assertIsoDate(account.compedUntil, "account.compedUntil");
  assertIsoDate(account.refilledAt, "account.refilledAt");
  if (account.subscription !== null) {
    assert(["stripe", "apple"].includes(account.subscription.provider));
    assert(
      ["active", "cancelling", "past_due", "ended", "unknown"].includes(
        account.subscription.status,
      ),
    );
  }
}

async function main(): Promise<void> {
  console.log(`[test API] ${API_URL}\n`);

  console.log("Checking authentication...");
  await expectProblem(
    () => unauthenticatedClient.getUser(),
    401,
    "authentication_required",
  );

  console.log(
    "Reading the user, accounts, profile, user app data, and session...",
  );
  const user = await client.getUser();
  assertUser(user);
  if (user.id !== EXPECTED_USER_ID) {
    throw new Error("Authenticated user does not match ROOL_TEST_USER_ID");
  }
  const accounts = await client.getAccounts();
  accounts.forEach(assertAccount);
  const home = accounts.find((account) => account.home);
  assert(home, "The user has a home account");
  assert.deepEqual(await client.getAccount(home.id), home);
  await expectProblem(
    () => client.getAccount("no-such-account"),
    404,
    "account_not_found",
  );

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
  assert.deepEqual(session.user, user);
  assert.deepEqual(session.accounts, accounts);
  assert.deepEqual(session.profile, profile);
  assert.deepEqual(session.userAppData, userAppData);
  assert(Array.isArray(session.machines));
  session.machines.forEach(assertMachineSummary);
  assert(session.syncToken);
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

  console.log("Reading the model catalog...");
  const catalog = await client.getModels();
  const defaultModel = catalog.models.find((m) => m.id === catalog.default);
  assert(defaultModel);
  for (const model of catalog.models) {
    assert(model.efforts.some((e) => e.id === model.defaultEffort));
  }

  console.log("Scheduling and cancelling user deletion...");
  await client.deleteUser();
  deletionRequested = true;
  const restoredUser = await client.getUser();
  deletionRequested = false;
  assertUser(restoredUser);
  assert.equal(restoredUser.id, user.id);

  console.log("\n✅ SDK user route smoke tests passed.");
}

async function cleanup(): Promise<void> {
  if (!originalProfile && !originalUserAppData && !deletionRequested) return;
  console.log("\nRestoring the local test user...");

  if (deletionRequested) {
    await client.getUser();
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
