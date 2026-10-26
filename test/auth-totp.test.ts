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
const continuation = `https://rool.dev/login/email#${"a".repeat(43)}`;
const session = { id_token: "verified-id", refresh_token: "refresh", rool_token: "proof", expires_in: 3600 };
let location: URL;

beforeEach(() => {
  location = new URL("https://rool.app/join-team/invite?account=team&verify=email-link");
  Object.assign(globalThis, {
    localStorage: new Storage(), sessionStorage: new Storage(), document: { title: "Rool" },
    window: { location, history: { replaceState() {} } },
  });
});

test("email links only start hosted login, a new web instance accepts the final callback", async () => {
  let body: Record<string, string> = {};
  const auth = new BrowserAuth({ authUrl, fetch: async (url, init) => {
    assert.equal(String(url), `${authUrl}/email/start`);
    body = JSON.parse(String(init?.body));
    return Response.json({ continuation_url: continuation });
  } });
  const events: boolean[] = [];
  auth.onAuthStateChanged(value => events.push(value));
  await auth.loginWithEmailLink("email-link");
  assert.equal(location.href, continuation);
  assert.equal(body.token, "email-link");
  assert.equal(body.redirect_uri, "https://rool.app/join-team/invite?account=team");
  assert.ok(body.state);
  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(events, []);

  // Website completes email verification and optional TOTP before returning.
  location.href = body.redirect_uri;
  location.hash = new URLSearchParams({ ...session, expires_in: "3600", state: body.state }).toString();
  const returned = new BrowserAuth({ authUrl });
  assert.equal(await returned.initialize(), true);
  assert.deepEqual(await returned.getTokens(), { accessToken: session.id_token, roolToken: session.rool_token });
});

test("native email login uses the same fresh PKCE and code callback with or without TOTP", async () => {
  let body: Record<string, string> = {};
  const opened: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const data = JSON.parse(String(init?.body));
    if (String(url).endsWith("/email/start")) {
      body = data;
      return Response.json({ continuation_url: continuation });
    }
    assert.equal(String(url), `${authUrl}/token`);
    assert.equal(createHash("sha256").update(data.code_verifier).digest("base64url"), body.code_challenge);
    return Response.json(session);
  };
  const config = { authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: (url: string) => { opened.push(url); }, fetch };
  const auth = new NativeAuth(config);
  await auth.loginWithEmailLink("email-link");
  assert.deepEqual(opened, [continuation]);
  assert.equal(await auth.isAuthenticated(), false);
  assert.equal(body.code_challenge_method, "S256");
  const restarted = new NativeAuth(config);
  assert.equal(await restarted.handleRedirect(`${body.redirect_uri}?code=verified-code&state=${body.state}`), true);
  assert.equal((await restarted.getTokens())?.roolToken, "proof");
});

test("a handoff cannot send the browser to another origin, page or credential-bearing URL", async () => {
  const original = location.href;
  for (const continuation_url of [
    "https://evil.test/login/email#" + "a".repeat(43),
    "https://rool.dev/login/2fa#" + "a".repeat(43),
    "https://user@rool.dev/login/email#" + "a".repeat(43),
    continuation.replace("#", "?token=secret#"),
    "https://rool.dev/login/email#short",
  ]) {
    const auth = new BrowserAuth({ authUrl, fetch: async () => Response.json({ continuation_url }) });
    await assert.rejects(auth.loginWithEmailLink("email-link"));
    assert.equal(location.href, original);
    assert.equal(await auth.isAuthenticated(), false);
  }
});

test("handoff failure is visible and does not install response tokens", async () => {
  const auth = new BrowserAuth({ authUrl, fetch: async () => Response.json({ message: "Try again shortly" }, { status: 503 }) });
  await assert.rejects(auth.loginWithEmailLink("email-link"), /Try again shortly/);
  const bad = new BrowserAuth({ authUrl, fetch: async () => Response.json(session) });
  await assert.rejects(bad.loginWithEmailLink("email-link"));
  assert.equal(await bad.isAuthenticated(), false);
});

test("native handoff cancellation prevents a late response from reopening the browser", async () => {
  let finish!: (response: Response) => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  const opened: string[] = [];
  const auth = new NativeAuth({
    authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: url => { opened.push(url); },
    fetch: () => { requested(); return new Promise(resolve => { finish = resolve; }); },
  });
  const login = auth.loginWithEmailLink("email-link");
  await started;
  auth.cancelLogin();
  finish(Response.json({ continuation_url: continuation }));
  await login;
  assert.deepEqual(opened, []);
  assert.equal(await auth.isAuthenticated(), false);
});

test("required attempt storage failures reject before opening a browser", async () => {
  Object.assign(globalThis, {
    sessionStorage: { setItem() { throw new Error("Storage blocked"); } },
    localStorage: { setItem() { throw new Error("Storage blocked"); }, getItem() { return null; }, removeItem() {} },
  });
  const browser = new BrowserAuth({ authUrl, fetch: async () => { throw new Error("Should not fetch"); } });
  await assert.rejects(browser.loginWithEmailLink("email-link"), /Storage blocked/);
  const native = new NativeAuth({ authUrl, redirectUri: "rooliosauth://auth/callback", openExternal: () => { throw new Error("Should not open"); } });
  await assert.rejects(native.login("Rool"), /storage is required/);
});

test("a late email handoff cannot replace a newer login or reopen after logout", async () => {
  let finish!: (response: Response) => void;
  const auth = new BrowserAuth({ authUrl, fetch: () => new Promise(resolve => { finish = resolve; }) });
  const email = auth.loginWithEmailLink("email-link");
  await auth.login("Rool");
  const newer = location.href;
  finish(Response.json({ continuation_url: continuation }));
  await email;
  assert.equal(location.href, newer);
  const second = auth.loginWithEmailLink("email-link");
  await auth.logout();
  finish(Response.json({ continuation_url: continuation }));
  await second;
  assert.equal(location.href, newer);
});
