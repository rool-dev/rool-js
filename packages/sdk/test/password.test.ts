import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { RoolClient } from '../src/client.js';
import type { AuthProvider, AuthTokens } from '../src/types.js';

const originalFetch = globalThis.fetch;

class TestAuthProvider implements AuthProvider {
  logoutCalls = 0;
  replacement: AuthTokens | null = null;
  private onAuthStateChanged: (authenticated: boolean) => void = () => {};

  async getTokens() {
    return { accessToken: 'id-token', roolToken: 'rool-token' };
  }

  getAuthUser() {
    return { email: 'person@example.com', name: 'Person' };
  }

  async isAuthenticated() {
    return true;
  }

  login() {}
  signup() {}

  replaceTokens(tokens: AuthTokens) {
    this.replacement = tokens;
  }

  logout() {
    this.logoutCalls++;
    this.onAuthStateChanged(false);
  }

  setAuthStateChangedHandler(handler: (authenticated: boolean) => void) {
    this.onAuthStateChanged = handler;
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('setPassword installs the replacement session', async () => {
  const provider = new TestAuthProvider();
  const authStates: boolean[] = [];
  const client = new RoolClient({
    authUrl: 'https://rool.dev/auth',
    authProvider: provider,
  });
  client.on('authStateChanged', (authenticated) => authStates.push(authenticated));

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://rool.dev/auth/set-password');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer id-token');
    assert.deepEqual(JSON.parse(String(init?.body)), { password: 'new-password-1' });
    return new Response(JSON.stringify({
      ok: true,
      id_token: 'new-id-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const earliestExpiry = Date.now() + 3600 * 1000;
  await client.setPassword('new-password-1');

  assert.equal(provider.logoutCalls, 0);
  assert.deepEqual(authStates, []);
  assert.equal(provider.replacement?.accessToken, 'new-id-token');
  assert.equal(provider.replacement?.refreshToken, 'new-refresh-token');
  assert.ok(provider.replacement!.expiresAt >= earliestExpiry);
  client.destroy();
});

test('setPassword logs out when the provider cannot install replacement credentials', async () => {
  const provider = new TestAuthProvider();
  (provider as { replaceTokens?: (tokens: AuthTokens) => void }).replaceTokens = undefined;
  const client = new RoolClient({
    authUrl: 'https://rool.dev/auth',
    authProvider: provider,
  });

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    id_token: 'new-id-token',
    refresh_token: 'new-refresh-token',
    expires_in: 3600,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  await client.setPassword('new-password-1');

  assert.equal(provider.logoutCalls, 1);
  client.destroy();
});

test('setPassword retains the session when the update fails', async () => {
  const provider = new TestAuthProvider();
  const client = new RoolClient({
    authUrl: 'https://rool.dev/auth',
    authProvider: provider,
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'Could not update password' }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    },
  );

  await assert.rejects(
    () => client.setPassword('new-password-1'),
    /Could not update password/,
  );
  assert.equal(provider.logoutCalls, 0);
  client.destroy();
});
