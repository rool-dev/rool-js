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
const session = { id_token: "verified-id", refresh_token: "refresh", rool_token: "proof", expires_in: 3600 };
let location: URL;

beforeEach(() => {
  location = new URL("https://rool.app/join-team/invite?account=team&verify=email-link");
  Object.assign(globalThis, {
    localStorage: new Storage(), sessionStorage: new Storage(), document: { title: "Rool" },
    window: { location, history: { replaceState() {} } },
  });
});

test("legacy app email links open hosted login directly, a new web instance accepts the final callback", async () => {
  const auth = new BrowserAuth({ authUrl, fetch: async () => { throw new Error("No email handoff request"); } });
  const events: boolean[] = [];
  auth.onAuthStateChanged(value => events.push(value));
  await auth.loginWithEmailLink("email-link");
  const login = new URL(location.href);
  assert.equal(login.origin + login.pathname, "https://rool.dev/login");
  assert.equal(new URLSearchParams(login.hash.slice(1)).get("verify"), "email-link");
  assert.equal(login.searchParams.get("redirect_uri"), "https://rool.app/join-team/invite?account=team");
  assert.equal(login.search.includes("email-link"), false);
  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(events, []);

  location.href = login.searchParams.get("redirect_uri")!;
  location.hash = new URLSearchParams({ ...session, expires_in: "3600", state: login.searchParams.get("state")! }).toString();
  const returned = new BrowserAuth({ authUrl });
  assert.equal(await returned.initialize(), true);
  assert.deepEqual(await returned.getTokens(), { accessToken: session.id_token, roolToken: session.rool_token });
});

test("native email uses ordinary authorization with fresh PKCE and a credential fragment", async () => {
  const opened: string[] = [];
  let challenge = "";
  const config = {
    authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: (url: string) => { opened.push(url); },
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), `${authUrl}/token`);
      const data = JSON.parse(String(init?.body));
      assert.equal(createHash("sha256").update(data.code_verifier).digest("base64url"), challenge);
      return Response.json(session);
    },
  };
  const auth = new NativeAuth(config);
  await auth.loginWithEmailLink("email-link");
  const login = new URL(opened[0]);
  assert.equal(login.origin + login.pathname, `${authUrl}/authorize`);
  assert.equal(new URLSearchParams(login.hash.slice(1)).get("verify"), "email-link");
  assert.equal(login.search.includes("email-link"), false);
  assert.equal(login.searchParams.get("code_challenge_method"), "S256");
  challenge = login.searchParams.get("code_challenge")!;
  assert.equal(await auth.isAuthenticated(), false);
  const restarted = new NativeAuth(config);
  assert.equal(await restarted.handleRedirect(`${config.redirectUri}?code=verified-code&state=${login.searchParams.get("state")}`), true);
  assert.equal((await restarted.getTokens())?.roolToken, "proof");
});

test("native cancellation while preparing PKCE does not reopen the browser", async () => {
  const opened: string[] = [];
  const auth = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: url => { opened.push(url); } });
  const login = auth.loginWithEmailLink("email-link");
  auth.cancelLogin();
  await login;
  assert.deepEqual(opened, []);
  assert.equal(await auth.isAuthenticated(), false);
});

test("a newer native login wins while an earlier email attempt is being prepared", async () => {
  const opened: string[] = [];
  const auth = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: url => { opened.push(url); } });
  const email = auth.loginWithEmailLink("email-link");
  const newer = auth.login("Rool");
  await Promise.all([email, newer]);
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0]).hash, "");
});

test("required attempt storage failures reject before opening a browser", async () => {
  Object.assign(globalThis, {
    sessionStorage: { setItem() { throw new Error("Storage blocked"); } },
    localStorage: { setItem() { throw new Error("Storage blocked"); }, getItem() { return null; }, removeItem() {} },
  });
  const browser = new BrowserAuth({ authUrl });
  await assert.rejects(browser.loginWithEmailLink("email-link"), /Storage blocked/);
  const native = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: () => { throw new Error("Should not open"); } });
  await assert.rejects(native.login("Rool"), /storage is required/);
});

test("failure to open hosted login is visible and invalidates the native attempt", async () => {
  let attempted!: URL;
  const auth = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: url => {
    attempted = new URL(url);
    throw new Error("Browser unavailable");
  } });
  await assert.rejects(auth.loginWithEmailLink("email-link"), /Browser unavailable/);
  assert.equal(await auth.handleRedirect(`rooliosauth://auth/callback?code=x&state=${attempted.searchParams.get("state")}`), false);
});
