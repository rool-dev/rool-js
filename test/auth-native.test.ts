import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createHash } from "node:crypto";
import { NativeAuth } from "../src/auth-native.js";

// Minimal localStorage so the inherited token storage works under node:test.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage =
  new MemStorage();

const REDIRECT_URI = "roolandroidauth://auth/callback";
const AUTH_URL = "https://rool.dev/auth";

function expectedChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

type FetchMock = (
  url: string,
  init: { body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function makeProvider(fetchMock: FetchMock) {
  const opened: string[] = [];
  const authStates: boolean[] = [];
  const provider = new NativeAuth({
    authUrl: AUTH_URL,
    redirectUri: REDIRECT_URI,
    fetch: fetchMock as unknown as typeof fetch,
    openExternal: (url) => {
      opened.push(url);
    },
  });
  provider.onAuthStateChanged((authenticated) =>
    authStates.push(authenticated),
  );
  return { provider, opened, authStates };
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage.clear();
});

test("login and signup use hosted auth and preserve invite metadata", async () => {
  const { provider, opened } = makeProvider(async () => { throw new Error("Unexpected fetch"); });
  await provider.login("Rool");
  const login = new URL(opened[0]);
  assert.equal(login.searchParams.get("provider"), null);
  assert.equal(login.searchParams.get("flow"), "login");
  assert.equal(login.searchParams.get("code_challenge_method"), "S256");
  await provider.signup("Rool", { invite: "team-invite-token", rvid: "visit-id" });
  const signup = new URL(opened[1]);
  assert.equal(signup.searchParams.get("flow"), "signup");
  assert.equal(signup.searchParams.get("invite"), "team-invite-token");
  assert.equal(signup.searchParams.get("rvid"), "visit-id");
});

test("login opens /authorize with an S256 challenge and completes via /token", async () => {
  let tokenBody: { code?: string; code_verifier?: string } = {};
  const { provider, opened, authStates } = makeProvider(async (url, init) => {
    assert.equal(url, `${AUTH_URL}/token`);
    tokenBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id_token: "header.payload.sig",
        refresh_token: "refresh-abc",
        rool_token: "rool-abc",
        expires_in: 3600,
      }),
    };
  });

  await provider.login("TestApp");

  assert.equal(opened.length, 1);
  const authorize = new URL(opened[0]);
  assert.equal(authorize.origin + authorize.pathname, `${AUTH_URL}/authorize`);
  assert.equal(authorize.searchParams.get("provider"), null);
  assert.equal(authorize.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const challenge = authorize.searchParams.get("code_challenge")!;
  const state = authorize.searchParams.get("state")!;
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

  const ok = await provider.handleRedirect(
    `${REDIRECT_URI}?code=auth-code-1&state=${state}`,
  );
  assert.equal(ok, true);

  // The verifier sent to /token must hash to the challenge sent to /authorize.
  assert.equal(tokenBody.code, "auth-code-1");
  assert.match(tokenBody.code_verifier!, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(expectedChallenge(tokenBody.code_verifier!), challenge);

  assert.deepEqual(authStates, [true]);
  assert.equal(await provider.isAuthenticated(), true);
  const tokens = await provider.getTokens();
  assert.equal(tokens?.accessToken, "header.payload.sig");
  assert.equal(tokens?.roolToken, "rool-abc");
});

test("handleRedirect rejects a state mismatch without exchanging", async () => {
  let called = false;
  const { provider } = makeProvider(async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  });

  await provider.login("TestApp");
  const ok = await provider.handleRedirect(
    `${REDIRECT_URI}?code=x&state=not-the-real-state`,
  );

  assert.equal(ok, false);
  assert.equal(called, false, "/token must not be called on state mismatch");
  assert.equal(await provider.isAuthenticated(), false);
});

test("handleRedirect surfaces a provider error param as failure", async () => {
  const { provider } = makeProvider(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }));
  await provider.login("TestApp");
  const ok = await provider.handleRedirect(
    `${REDIRECT_URI}?error=access_denied`,
  );
  assert.equal(ok, false);
  assert.equal(await provider.isAuthenticated(), false);
});

test("handleRedirect ignores deep links for other URIs", async () => {
  const { provider } = makeProvider(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }));
  await provider.login("TestApp");
  const ok = await provider.handleRedirect(
    "https://example.com/callback?code=x&state=y",
  );
  assert.equal(ok, false);
});

test("callbacks require the exact URI and a matching pending state", async () => {
  const { provider, opened } = makeProvider(async () => { throw new Error("Must not exchange"); });
  await provider.login("Rool");
  const state = new URL(opened[0]).searchParams.get("state");
  for (const url of [
    `${REDIRECT_URI}-other?code=x&state=${state}`,
    `${REDIRECT_URI}?code=x`,
    `${REDIRECT_URI}?code=x&state=${state}#fragment`,
  ]) assert.equal(await provider.handleRedirect(url), false);
  provider.cancelLogin();
  assert.equal(await provider.handleRedirect(`${REDIRECT_URI}?code=x&state=${state}`), false);
});

test("a cold-start instance can complete the stored browser attempt", async () => {
  const { provider, opened } = makeProvider(async () => { throw new Error("Unused"); });
  await provider.login("Rool");
  const state = new URL(opened[0]).searchParams.get("state");
  const restarted = makeProvider(async () => ({
    ok: true, status: 200,
    json: async () => ({ id_token: "cold-start", refresh_token: "refresh", expires_in: 3600 }),
  }));
  assert.equal(await restarted.provider.handleRedirect(`${REDIRECT_URI}?code=x&state=${state}`), true);
});

test("email sign-in wins over an in-flight browser exchange", async () => {
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const { provider, opened, authStates } = makeProvider(async (url) => {
    const browser = url.endsWith("/token");
    if (browser) await paused;
    return {
      ok: true, status: 200,
      json: async () => ({ id_token: browser ? "browser-user" : "email-user", refresh_token: "refresh", expires_in: 3600 }),
    };
  });
  await provider.login("Rool");
  const state = new URL(opened[0]).searchParams.get("state");
  const returning = provider.handleRedirect(`${REDIRECT_URI}?code=x&state=${state}`);
  assert.equal(await provider.verify("email-link"), true);
  release();
  assert.equal(await returning, false);
  assert.equal((await provider.getTokens())?.accessToken, "email-user");
  assert.deepEqual(authStates, [true]);
});

test("starting email verification invalidates the browser before email responds", async () => {
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const { provider, opened } = makeProvider(async (url) => {
    assert.equal(url, `${AUTH_URL}/verify-and-signin`);
    await paused;
    return { ok: true, status: 200, json: async () => ({ id_token: "email", expires_in: 3600 }) };
  });
  await provider.login("Rool");
  const state = new URL(opened[0]).searchParams.get("state");
  const verifying = provider.verify("email-link");
  assert.equal(await provider.handleRedirect(`${REDIRECT_URI}?code=late&state=${state}`), false);
  release();
  assert.equal(await verifying, true);
});

test("cancelling an in-flight exchange prevents it from signing in", async () => {
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const { provider, opened } = makeProvider(async () => {
    await paused;
    return { ok: true, status: 200, json: async () => ({ id_token: "late", expires_in: 3600 }) };
  });
  await provider.login("Rool");
  const state = new URL(opened[0]).searchParams.get("state");
  const returning = provider.handleRedirect(`${REDIRECT_URI}?code=x&state=${state}`);
  provider.cancelLogin();
  release();
  assert.equal(await returning, false);
  assert.equal(await provider.isAuthenticated(), false);
});

test("provider parameters cannot select the legacy native flow", async () => {
  const { provider, opened } = makeProvider(async () => { throw new Error("Unexpected fetch"); });
  for (const selected of ["google", "apple"]) {
    await provider.login("Rool", { provider: selected });
    await provider.signup("Rool", { provider: selected });
  }
  for (const url of opened) {
    assert.equal(new URL(url).searchParams.get("provider"), null);
  }
});
