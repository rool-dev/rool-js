import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createHash } from 'node:crypto';
import { NativePkceAuthProvider } from '../src/auth-native.js';

// Minimal localStorage so the inherited token storage works under node:test.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

const REDIRECT_URI = 'roolandroidauth://auth/callback';
const AUTH_URL = 'https://rool.dev/auth';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function expectedChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

type FetchMock = (url: string, init: { body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const liveProviders: NativePkceAuthProvider[] = [];

function makeProvider(fetchMock: FetchMock) {
  const opened: string[] = [];
  const authStates: boolean[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock as unknown;

  const provider = new NativePkceAuthProvider({
    redirectUri: REDIRECT_URI,
    openExternal: (url) => { opened.push(url); },
  });
  // RoolClient injects these for a custom provider; do the same here.
  provider.setAuthUrl(AUTH_URL);
  provider.setLogger(silentLogger);
  provider.setAuthStateChangedHandler((a) => authStates.push(a));
  liveProviders.push(provider);
  return { provider, opened, authStates };
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage.clear();
});

// Signing in arms a ~45-min refresh setTimeout; clear it so node --test can
// drain the event loop and exit instead of hanging.
afterEach(() => {
  while (liveProviders.length) liveProviders.pop()!.destroy();
});

test('login opens /authorize with an S256 challenge and completes via /token', async () => {
  let tokenBody: { code?: string; code_verifier?: string } = {};
  const { provider, opened, authStates } = makeProvider(async (url, init) => {
    assert.equal(url, `${AUTH_URL}/token`);
    tokenBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id_token: 'header.payload.sig',
        refresh_token: 'refresh-abc',
        rool_token: 'rool-abc',
        expires_in: 3600,
      }),
    };
  });

  await provider.login('TestApp', { provider: 'google' });

  assert.equal(opened.length, 1);
  const authorize = new URL(opened[0]);
  assert.equal(authorize.origin + authorize.pathname, `${AUTH_URL}/authorize`);
  assert.equal(authorize.searchParams.get('provider'), 'google');
  assert.equal(authorize.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  const challenge = authorize.searchParams.get('code_challenge')!;
  const state = authorize.searchParams.get('state')!;
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

  const ok = await provider.handleRedirect(`${REDIRECT_URI}?code=auth-code-1&state=${state}`);
  assert.equal(ok, true);

  // The verifier sent to /token must hash to the challenge sent to /authorize.
  assert.equal(tokenBody.code, 'auth-code-1');
  assert.match(tokenBody.code_verifier!, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(expectedChallenge(tokenBody.code_verifier!), challenge);

  assert.deepEqual(authStates, [true]);
  assert.equal(await provider.isAuthenticated(), true);
  const tokens = await provider.getTokens();
  assert.equal(tokens?.accessToken, 'header.payload.sig');
  assert.equal(tokens?.roolToken, 'rool-abc');
});

test('handleRedirect rejects a state mismatch without exchanging', async () => {
  let called = false;
  const { provider } = makeProvider(async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  });

  await provider.login('TestApp');
  const ok = await provider.handleRedirect(`${REDIRECT_URI}?code=x&state=not-the-real-state`);

  assert.equal(ok, false);
  assert.equal(called, false, '/token must not be called on state mismatch');
  assert.equal(await provider.isAuthenticated(), false);
});

test('handleRedirect surfaces a provider error param as failure', async () => {
  const { provider } = makeProvider(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  await provider.login('TestApp');
  const ok = await provider.handleRedirect(`${REDIRECT_URI}?error=access_denied`);
  assert.equal(ok, false);
  assert.equal(await provider.isAuthenticated(), false);
});

test('handleRedirect ignores deep links for other URIs', async () => {
  const { provider } = makeProvider(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  await provider.login('TestApp');
  const ok = await provider.handleRedirect('https://example.com/callback?code=x&state=y');
  assert.equal(ok, false);
});
