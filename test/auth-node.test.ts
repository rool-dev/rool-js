import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeAuth } from "../src/auth-node.js";

async function temporaryCredentialsPath(): Promise<{
  directory: string;
  path: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "rool-node-auth-"));
  return { directory, path: join(directory, "credentials.json") };
}

test("logs in through a loopback callback and stores credentials", async (t) => {
  const credentials = await temporaryCredentialsPath();
  t.after(() => rm(credentials.directory, { recursive: true, force: true }));

  let openedUrl: URL | undefined;
  const auth = new NodeAuth({
    apiUrl: "https://api.example.com",
    credentialsPath: credentials.path,
    openUrl: async (value) => {
      openedUrl = new URL(value);
      const redirectUri = openedUrl.searchParams.get("redirect_uri");
      const state = openedUrl.searchParams.get("state");
      assert(redirectUri);
      assert(state);

      const response = await fetch(new URL("/callback", redirectUri), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          id_token: "access-token",
          refresh_token: "refresh-token",
          rool_token: "rool-token",
          expires_in: "3600",
          state,
        }),
      });
      assert.equal(response.status, 200);
    },
  });

  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));
  assert.equal(await auth.initialize(), false);

  await auth.login("Node auth test");

  assert.equal(openedUrl?.origin, "https://example.com");
  assert.equal(openedUrl?.pathname, "/login");
  assert.deepEqual(await auth.getTokens(), {
    accessToken: "access-token",
    roolToken: "rool-token",
  });
  assert.equal(await auth.getAccessToken(), "access-token");
  assert.equal((await stat(credentials.path)).mode & 0o777, 0o600);
  assert.deepEqual(states, [true]);

  await auth.logout();
  assert.deepEqual(states, [true, false]);
  assert.equal(await auth.getTokens(), undefined);
});

test("repeated logout reports sign-out once", async (t) => {
  const credentials = await temporaryCredentialsPath();
  t.after(() => rm(credentials.directory, { recursive: true, force: true }));
  await writeFile(
    credentials.path,
    JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      rool_token: "rool-token",
      expires_at: Date.now() + 3_600_000,
    }),
  );

  const auth = new NodeAuth({
    apiUrl: "https://api.example.com",
    credentialsPath: credentials.path,
  });
  const states: boolean[] = [];
  auth.onAuthStateChanged((authenticated) => states.push(authenticated));

  await auth.logout();
  await auth.logout();

  assert.deepEqual(states, [false]);
});

test("refreshes once for concurrent token requests", async (t) => {
  const credentials = await temporaryCredentialsPath();
  t.after(() => rm(credentials.directory, { recursive: true, force: true }));
  await writeFile(
    credentials.path,
    JSON.stringify({
      access_token: "expired-access-token",
      refresh_token: "refresh-token",
      rool_token: "old-rool-token",
      expires_at: 0,
    }),
  );

  let refreshes = 0;
  const auth = new NodeAuth({
    apiUrl: "https://api.example.com",
    credentialsPath: credentials.path,
    fetch: async (_input, init) => {
      refreshes += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        refresh_token: "refresh-token",
        rool_token: "old-rool-token",
      });
      return new Response(
        JSON.stringify({
          id_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          rool_token: "fresh-rool-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  assert.deepEqual(await Promise.all([auth.getTokens(), auth.getTokens()]), [
    {
      accessToken: "fresh-access-token",
      roolToken: "fresh-rool-token",
    },
    {
      accessToken: "fresh-access-token",
      roolToken: "fresh-rool-token",
    },
  ]);
  assert.equal(refreshes, 1);

  const stored = JSON.parse(await readFile(credentials.path, "utf8")) as {
    access_token: string;
    rool_token: string;
  };
  assert.equal(stored.access_token, "fresh-access-token");
  assert.equal(stored.rool_token, "fresh-rool-token");
});

test("stops waiting when the browser launcher fails", async (t) => {
  const credentials = await temporaryCredentialsPath();
  t.after(() => rm(credentials.directory, { recursive: true, force: true }));
  const auth = new NodeAuth({
    apiUrl: "https://api.example.com",
    credentialsPath: credentials.path,
    loginTimeoutMs: 60_000,
    openUrl: () => {
      throw new Error("browser unavailable");
    },
  });

  await assert.rejects(
    () => auth.login("Node auth test"),
    /browser unavailable/,
  );
});

test("reports a missing credential file as unauthenticated", async (t) => {
  const credentials = await temporaryCredentialsPath();
  t.after(() => rm(credentials.directory, { recursive: true, force: true }));
  const auth = new NodeAuth({
    apiUrl: "https://api.example.com",
    credentialsPath: credentials.path,
  });

  assert.equal(await auth.isAuthenticated(), false);
});

test("requires an auth URL for a loopback API", () => {
  assert.throws(
    () => new NodeAuth({ apiUrl: "http://localhost:1357" }),
    /authUrl is required/,
  );
});
