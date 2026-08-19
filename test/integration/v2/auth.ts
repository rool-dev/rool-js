import { NodeAuth } from "../../../src/auth-node.js";

export type TestAuthProfile = "primary" | "member";

export function createTestAuth(
  apiUrl: string,
  profile: TestAuthProfile,
): NodeAuth {
  return new NodeAuth({
    apiUrl,
    authUrl: process.env.ROOL_TEST_AUTH_URL || undefined,
    profile: `sdk-v2-${profile}`,
  });
}
