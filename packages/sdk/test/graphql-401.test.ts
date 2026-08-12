import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { RoolClient } from '../src/client.js';
import type { AuthProvider, AuthTokens } from '../src/types.js';

const originalFetch = globalThis.fetch;

class TestAuthProvider implements AuthProvider {
  logoutCalls = 0;
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

  replaceTokens(_tokens: AuthTokens) {}

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

test('a GraphQL 401 ends the session', async () => {
  const provider = new TestAuthProvider();
  const authStates: boolean[] = [];
  const client = new RoolClient({
    authUrl: 'https://rool.dev/auth',
    authProvider: provider,
  });
  client.on('authStateChanged', (authenticated) => authStates.push(authenticated));

  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

  await assert.rejects(() => client.getCurrentUser(), /401/);
  assert.equal(provider.logoutCalls, 1);
  assert.deepEqual(authStates, [false]);
});

test('a GraphQL 5xx does not end the session', async () => {
  const provider = new TestAuthProvider();
  const client = new RoolClient({
    authUrl: 'https://rool.dev/auth',
    authProvider: provider,
  });

  globalThis.fetch = async () => new Response('Bad Gateway', { status: 502 });

  await assert.rejects(() => client.getCurrentUser(), /502/);
  assert.equal(provider.logoutCalls, 0);
});
