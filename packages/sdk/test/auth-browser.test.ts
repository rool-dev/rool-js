import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { BrowserAuth } from "../src/auth-browser.js";

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
const location = {
  hash: "",
  href: "https://app.example/start?source=test",
  origin: "https://app.example",
  pathname: "/start",
  search: "?source=test",
};
let replacedUrl = "";

Object.defineProperty(globalThis, "localStorage", { value: local });
Object.defineProperty(globalThis, "sessionStorage", { value: session });
Object.defineProperty(globalThis, "window", {
  value: {
    crypto: globalThis.crypto,
    location,
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        replacedUrl = url;
      },
    },
  },
});
Object.defineProperty(globalThis, "document", {
  value: { title: "Test" },
});

beforeEach(() => {
  local.clear();
  session.clear();
  location.hash = "";
  location.href = "https://app.example/start?source=test";
  replacedUrl = "";
});

test("browser auth redirects, accepts paired tokens, and reports state", async () => {
  const auth = new BrowserAuth({ authUrl: "https://rool.dev/auth" });
  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));

  await auth.login("Test App", { rvid: "referrer" });
  const login = new URL(location.href);
  assert.equal(login.href.startsWith("https://rool.dev/login?"), true);
  assert.equal(login.searchParams.get("app_name"), "Test App");
  assert.equal(login.searchParams.get("rvid"), "referrer");
  assert.equal(
    login.searchParams.get("redirect_uri"),
    "https://app.example/start?source=test",
  );

  location.hash = new URLSearchParams({
    id_token: "access-token",
    refresh_token: "refresh-token",
    rool_token: "rool-token",
    expires_in: "3600",
    state: login.searchParams.get("state")!,
  }).toString();

  assert.equal(await auth.initialize(), true);
  assert.deepEqual(await auth.getTokens(), {
    accessToken: "access-token",
    roolToken: "rool-token",
  });
  assert.deepEqual(states, [true]);
  assert.equal(replacedUrl, "https://app.example/start?source=test");

  await auth.logout();
  assert.equal(await auth.isAuthenticated(), false);
  assert.deepEqual(states, [true, false]);
});

test("browser signup uses the hosted signup page", async () => {
  const auth = new BrowserAuth({ authUrl: "https://rool.dev/auth" });
  await auth.signup("Test App");
  assert.equal(new URL(location.href).pathname, "/signup");
});
