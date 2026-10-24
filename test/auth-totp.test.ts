import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createHash } from "node:crypto";
import { BrowserAuth } from "../src/auth-browser.js";
import { NativeAuth } from "../src/auth-native.js";

class Storage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const authUrl = "https://rool.dev/auth";
const continuation = `https://rool.dev/login/2fa#pending`;
const session = { id_token: "verified-id", refresh_token: "refresh", rool_token: "proof", expires_in: 3600 };
let assigned: string;
let location: URL;

beforeEach(() => {
  assigned = "";
  location = new URL("https://rool.app/chat?verify=email-link");
  Object.assign(globalThis, {
    localStorage: new Storage(), sessionStorage: new Storage(), document: { title: "Rool" },
    window: { location: Object.assign(location, { assign: (url: string) => { assigned = url; } }), history: { replaceState() {} } },
  });
});

test("browser magic-link verification waits for TOTP and preserves the callback state", async () => {
  let body: Record<string, string> = {};
  const auth = new BrowserAuth({ authUrl, fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ status: "second_factor_required", continuation_url: continuation });
  } });
  const events: boolean[] = [];
  auth.onAuthStateChanged((value) => events.push(value));
  assert.equal(await auth.verify("email-link"), true);
  assert.equal(assigned, continuation);
  assert.equal(body.redirect_uri, "https://rool.app/chat");
  assert.ok(body.state);
  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(events, []);
  location.hash = new URLSearchParams({ ...session, expires_in: "3600", state: body.state }).toString();
  assert.equal(await auth.initialize(), true);
  assert.deepEqual(await auth.getTokens(), { accessToken: session.id_token, roolToken: session.rool_token });
  assert.deepEqual(events, [true]);
});

test("native magic-link TOTP returns through a fresh PKCE attempt", async () => {
  let body: Record<string, string> = {};
  const opened: string[] = [];
  const auth = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: (url) => { opened.push(url); }, fetch: async (url, init) => {
    const data = JSON.parse(String(init?.body));
    if (String(url).endsWith("verify-and-signin")) {
      body = data;
      return Response.json({ status: "second_factor_required", continuation_url: continuation });
    }
    assert.equal(String(url), `${authUrl}/token`);
    assert.equal(createHash("sha256").update(data.code_verifier).digest("base64url"), body.code_challenge);
    return Response.json(session);
  } });
  assert.equal(await auth.verify("email-link"), true);
  assert.deepEqual(opened, [continuation]);
  assert.equal(await auth.isAuthenticated(), false);
  assert.equal(body.code_challenge_method, "S256");
  assert.equal(await auth.handleRedirect(`${body.redirect_uri}?code=verified-code&state=${body.state}`), true);
  assert.equal((await auth.getTokens())?.roolToken, "proof");
});

test("native email links without TOTP still redeem the bound callback", async () => {
  const auth = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: () => { throw new Error("No browser needed"); }, fetch: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    return String(url).endsWith("verify-and-signin")
      ? Response.json({ redirect_uri: `${body.redirect_uri}?code=email-code&state=${body.state}` })
      : Response.json(session);
  } });
  assert.equal(await auth.verify("email-link"), true);
  assert.equal(await auth.isAuthenticated(), true);
});

test("a verification response cannot send the browser to another origin", async () => {
  const auth = new BrowserAuth({ authUrl, fetch: async () => Response.json({ status: "second_factor_required", continuation_url: "https://evil.test/login/2fa" }) });
  assert.equal(await auth.verify("email-link"), false);
  assert.equal(assigned, "");
});
