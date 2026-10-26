import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { NativeAuth } from "../src/auth-native.js";
import { EmailChangeError } from "../src/index.js";

class MemStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
beforeEach(() => { Object.assign(globalThis, { localStorage: new MemStorage() }); });

const signedIn = { id_token: "id-token", refresh_token: "refresh-token", rool_token: "rool-token", expires_in: 3600 };

// Settings requests start with an already completed hosted login, not an email
// exchange. Seed the same session the callback installs.
class SignedInAuth extends NativeAuth {
  signIn() { this.acceptTokenResponse(signedIn); this.emitAuthState(true); }
}
function authWithResponse(response: Response, onRequest?: (url: string, init?: RequestInit) => void) {
  const auth = new SignedInAuth({
    authUrl: "https://rool.dev/auth", redirectUri: "rooliosauth://auth/callback", openExternal() {},
    fetch: async (url, init) => { onRequest?.(String(url), init); return response; },
  });
  auth.signIn();
  return auth;
}

test("setPassword sends both credentials and signs out after success", async () => {
  const auth = authWithResponse(Response.json({ ok: true }), (url, init) => {
    assert.equal(url, "https://rool.dev/auth/set-password");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer id-token");
    assert.equal(new Headers(init?.headers).get("X-Rool-Token"), "rool-token");
    assert.deepEqual(JSON.parse(String(init?.body)), { password: "new-password-1" });
  });
  const states: boolean[] = [];
  auth.onAuthStateChanged(value => states.push(value));
  await auth.setPassword("new-password-1");
  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(states, [false]);
});

test("setPassword retains the session on failure and shows the server's message", async () => {
  const auth = authWithResponse(Response.json({ error: "second_factor_required", message: "Sign in again and complete two-factor verification." }, { status: 401 }));
  await assert.rejects(auth.setPassword("new-password-1"), /Sign in again and complete two-factor verification/);
  assert.deepEqual(await auth.getTokens(), { accessToken: "id-token", roolToken: "rool-token" });
});

test("requestEmailChange sends both credentials and the new address", async () => {
  const auth = authWithResponse(Response.json({ ok: true }), (url, init) => {
    assert.equal(url, "https://rool.dev/auth/email-change");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer id-token");
    assert.equal(new Headers(init?.headers).get("X-Rool-Token"), "rool-token");
    assert.deepEqual(JSON.parse(String(init?.body)), { new_email: "new@example.com" });
  });
  await auth.requestEmailChange("new@example.com");
});

test("requestEmailChange exposes a typed refusal", async () => {
  const auth = authWithResponse(Response.json({ error: "email_in_use", message: "That email already has an account." }, { status: 409 }));
  await assert.rejects(auth.requestEmailChange("used@example.com"), error =>
    error instanceof EmailChangeError && error.code === "email_in_use" && error.message === "That email already has an account.");
});
