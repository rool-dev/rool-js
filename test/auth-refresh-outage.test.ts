import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { BrowserAuth } from "../src/auth-browser.js";
import { RoolAuthUnavailableError } from "../src/auth-base.js";
import { RoolClient } from "../src/client.js";

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

const local = new MemStorage();
const session = new MemStorage();

Object.defineProperty(globalThis, "localStorage", { value: local });
Object.defineProperty(globalThis, "sessionStorage", { value: session });

const AUTH_URL = "https://rool.dev/auth";

// Mirrors TokenAuth's endpoint hash so tests can seed storage directly.
function endpointHash(url: string): string {
  let hash = 5381;
  for (const character of url) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function seedTokens(expiresAt: number): void {
  const prefix = `rool_${endpointHash(AUTH_URL)}_`;
  local.setItem(`${prefix}access_token`, "current-access");
  local.setItem(`${prefix}refresh_token`, "current-refresh");
  local.setItem(`${prefix}rool_token`, "current-rool");
  local.setItem(`${prefix}token_expires_at`, Math.floor(expiresAt).toString());
}

function fetchStub(
  handler: (url: string) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return ((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input)))) as typeof globalThis.fetch;
}

beforeEach(() => {
  local.clear();
  session.clear();
});

test("transient refresh failure keeps serving a still-valid token", async () => {
  seedTokens(Date.now() + 5 * 60 * 1000); // inside the 15-min refresh buffer
  const auth = new BrowserAuth({
    authUrl: AUTH_URL,
    fetch: fetchStub(() => new Response("bad gateway", { status: 502 })),
  });
  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));

  const tokens = await auth.getTokens();
  assert.deepEqual(tokens, {
    accessToken: "current-access",
    roolToken: "current-rool",
  });
  assert.deepEqual(states, []);
  assert.equal(await auth.isAuthenticated(), true);
});

test("transient refresh failure with an expired token fails locally, keeping credentials", async () => {
  seedTokens(Date.now() - 1000);
  const auth = new BrowserAuth({
    authUrl: AUTH_URL,
    fetch: fetchStub(() => new Response("bad gateway", { status: 502 })),
  });
  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));

  await assert.rejects(auth.getTokens(), RoolAuthUnavailableError);
  // Credentials survive the outage so a later refresh can still succeed.
  assert.equal(await auth.isAuthenticated(), true);
  assert.deepEqual(states, []);
});

test("recovery after an outage: a later successful refresh restores tokens", async () => {
  seedTokens(Date.now() - 1000);
  let failing = true;
  const auth = new BrowserAuth({
    authUrl: AUTH_URL,
    fetch: fetchStub(() =>
      failing
        ? new Response("bad gateway", { status: 502 })
        : Response.json({
            id_token: "fresh-access",
            refresh_token: "fresh-refresh",
            rool_token: "fresh-rool",
            expires_in: 3600,
          }),
    ),
  });

  await assert.rejects(auth.getTokens(), RoolAuthUnavailableError);
  failing = false;
  assert.deepEqual(await auth.getTokens(), {
    accessToken: "fresh-access",
    roolToken: "fresh-rool",
  });
});

test("rejected refresh clears credentials and reports signed out", async () => {
  seedTokens(Date.now() - 1000);
  const auth = new BrowserAuth({
    authUrl: AUTH_URL,
    fetch: fetchStub(
      () => new Response(JSON.stringify({ error: "invalid" }), { status: 401 }),
    ),
  });
  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));

  assert.equal(await auth.getTokens(), undefined);
  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(states, [false]);
});

test("a 401 on an authenticated request fires onAuthInvalidated", async () => {
  let invalidated = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example",
    fetch: fetchStub(() => new Response("unauthorized", { status: 401 })),
    getTokens: async () => ({ accessToken: "token", roolToken: "rool" }),
    onAuthInvalidated: () => {
      invalidated += 1;
    },
  });

  await assert.rejects(client.getSession());
  assert.equal(invalidated, 1);
});

test("a 401 on an unauthenticated request does not fire onAuthInvalidated", async () => {
  let invalidated = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example",
    fetch: fetchStub(() => new Response("unauthorized", { status: 401 })),
    getTokens: async () => undefined,
    onAuthInvalidated: () => {
      invalidated += 1;
    },
  });

  await assert.rejects(client.getSession());
  assert.equal(invalidated, 0);
});
