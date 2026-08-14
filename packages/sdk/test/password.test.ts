import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { NativeAuth } from "../src/auth-native.js";

class MemStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const storage = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = storage;

beforeEach(() => storage.clear());

function authWithResponses(responses: Response[]): NativeAuth {
  return new NativeAuth({
    authUrl: "https://rool.dev/auth",
    redirectUri: "rool://auth/callback",
    openExternal() {},
    fetch: async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected auth request");
      return response;
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const signedIn = {
  ok: true,
  status: "signed_in",
  id_token: "id-token",
  refresh_token: "refresh-token",
  rool_token: "rool-token",
  expires_in: 3600,
};

test("setPassword installs the replacement session", async () => {
  const auth = authWithResponses([
    jsonResponse(signedIn),
    jsonResponse({
      id_token: "new-id-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
    }),
  ]);

  await auth.signInWithPassword("person@example.com", "password-1");
  await auth.setPassword("new-password-1");

  assert.deepEqual(await auth.getTokens(), {
    accessToken: "new-id-token",
    roolToken: "rool-token",
  });
});

test("setPassword logs out when replacement credentials are invalid", async () => {
  const auth = authWithResponses([
    jsonResponse(signedIn),
    jsonResponse({ id_token: "new-id-token" }),
  ]);
  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));

  await auth.signInWithPassword("person@example.com", "password-1");
  await auth.setPassword("new-password-1");

  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(states, [true, false]);
});

test("setPassword retains the session when the update fails", async () => {
  const auth = authWithResponses([
    jsonResponse(signedIn),
    jsonResponse({ error: "Could not update password" }, 500),
  ]);

  await auth.signInWithPassword("person@example.com", "password-1");
  await assert.rejects(
    () => auth.setPassword("new-password-1"),
    /Could not update password/,
  );
  assert.deepEqual(await auth.getTokens(), {
    accessToken: "id-token",
    roolToken: "rool-token",
  });
});
