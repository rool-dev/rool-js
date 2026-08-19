import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { NativeAuth } from "../src/auth-native.js";
import { EmailChangeError } from "../src/index.js";

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

function authWithResponses(
  responses: Response[],
  onRequest?: (url: string, init?: RequestInit) => void,
): NativeAuth {
  return new NativeAuth({
    authUrl: "https://rool.dev/auth",
    redirectUri: "rool://auth/callback",
    openExternal() {},
    fetch: async (input, init) => {
      onRequest?.(String(input), init);
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

test("requestEmailChange sends the authenticated new address", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const auth = authWithResponses(
    [jsonResponse(signedIn), jsonResponse({ ok: true })],
    (url, init) => requests.push({ url, init }),
  );

  await auth.signInWithPassword("person@example.com", "password-1");
  await auth.requestEmailChange("new@example.com");

  const request = requests[1];
  assert(request);
  assert.equal(request.url, "https://rool.dev/auth/email-change");
  assert.equal(request.init?.method, "POST");
  assert.equal(
    new Headers(request.init?.headers).get("Authorization"),
    "Bearer id-token",
  );
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    new_email: "new@example.com",
  });
});

test("requestEmailChange exposes a typed refusal", async () => {
  const auth = authWithResponses([
    jsonResponse(signedIn),
    jsonResponse(
      {
        error: "email_in_use",
        message: "That email already has an account.",
      },
      409,
    ),
  ]);

  await auth.signInWithPassword("person@example.com", "password-1");
  await assert.rejects(
    () => auth.requestEmailChange("used@example.com"),
    (error) =>
      error instanceof EmailChangeError &&
      error.code === "email_in_use" &&
      error.message === "That email already has an account.",
  );
});
