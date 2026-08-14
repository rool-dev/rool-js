import { RoolClient } from "../../../src/index.js";
import { createTestAuth, type TestAuthProfile } from "./auth.js";
import { API_URL } from "./harness.js";

const accounts: { profile: TestAuthProfile; label: string }[] = [
  { profile: "primary", label: "primary smoke-test account" },
  { profile: "member", label: "member smoke-test account" },
];

async function main(): Promise<void> {
  for (const account of accounts) {
    const auth = createTestAuth(API_URL, account.profile);
    console.log(`\nLog in with the ${account.label}.`);
    await auth.login("Rool SDK v2 smoke tests");

    const client = new RoolClient({
      apiUrl: API_URL,
      getTokens: auth.getTokens,
      onAuthInvalidated: auth.logout,
    });
    const authenticatedAccount = await client.getAccount();
    console.log(
      `${account.profile}: ${authenticatedAccount.email} (${authenticatedAccount.id})`,
    );
  }

  console.log(
    "\nSet ROOL_TEST_USER_ID to the primary account ID, then run pnpm test:v2.",
  );
}

main().catch((error) => {
  console.error(
    "\n❌ Login failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
