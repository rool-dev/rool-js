import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient, RoolProblem, type WebdavCredential, type MachineWebdavCredentialsView, type RoolClientEvent } from "../src/index.js";
import { RoolMachine, type RoolMachineTransport } from "../src/machine.js";

const credential: WebdavCredential = {
  id: "rooldav_example",
  userId: "member",
  name: "My laptop",
  url: "https://machine.rool.cloud/",
  username: "rooldav_example",
  createdAt: "2026-10-27T12:00:00.000Z",
  lastUsedAt: null,
};

test("WebDAV credentials use machine-scoped authenticated routes and unwrap the list", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example",
    getAccessToken: async () => "token",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return Response.json({ ...credential, password: "one-time-secret" }, { status: 201 });
      return Response.json({ credentials: [credential] });
    },
  });
  const api = client.machine("machine/one").webdavCredentials;
  assert.deepEqual(await api.list(), [credential]);
  assert.deepEqual(await api.create({ name: "My laptop" }), { ...credential, password: "one-time-secret" });
  assert.equal(await api.revoke("credential/one"), undefined);
  assert.deepEqual(requests.map(request => request.url), [
    "https://api.example/v2/machines/machine%2Fone/webdav-credentials",
    "https://api.example/v2/machines/machine%2Fone/webdav-credentials",
    "https://api.example/v2/machines/machine%2Fone/webdav-credentials/credential%2Fone",
  ]);
  assert.equal(requests[1].init?.body, JSON.stringify({ name: "My laptop" }));
  assert.equal(new Headers(requests[1].init?.headers).get("Content-Type"), "application/json");
});

test("WebDAV credential failures preserve the server's problem", async () => {
  const client = new RoolClient({
    fetch: async () => Response.json({ type: "https://rool.dev/problems/forbidden", title: "Forbidden", status: 403, code: "forbidden" }, {
      status: 403, headers: { "Content-Type": "application/problem+json" },
    }),
  });
  const api = client.machine("machine").webdavCredentials;
  for (const operation of [() => api.list(), () => api.create({ name: "Laptop" }), () => api.revoke("credential")]) {
    await assert.rejects(operation, error => error instanceof RoolProblem && error.status === 403);
  }
});

function watchedCredentials() {
  const events = new Set<(event: RoolClientEvent) => void>();
  let records = [credential];
  let load = async () => records;
  let create = async () => {
    records = [credential];
    return { ...credential, password: "one-time-secret" };
  };
  let requests = 0;
  const signals: AbortSignal[] = [];
  const transport: RoolMachineTransport = {
    send: async () => { throw new Error("Unexpected send"); },
    request: async () => { records = []; return new Response(null, { status: 204 }); },
    requestJson: async <T>(path: string, init?: RequestInit): Promise<T> => {
      assert.equal(path, "/v2/machines/machine/webdav-credentials");
      if (init?.method === "POST") return await create() as T;
      requests++;
      if (init?.signal) signals.push(init.signal);
      return { credentials: await load() } as T;
    },
    subscribeEvents: listener => { events.add(listener); return () => { events.delete(listener); }; },
    deleted: () => {},
  };
  return {
    api: new RoolMachine("machine", transport).webdavCredentials,
    events, signals,
    get requests() { return requests; },
    setRecords: (next: WebdavCredential[]) => { records = next; },
    setLoad: (next: () => Promise<WebdavCredential[]>) => { load = next; },
    setCreate: (next: typeof create) => { create = next; },
    emit: (type: "webdav_credentials_changed" | "machines_changed" | "machine_members_changed", machineId = "machine") => {
      for (const listener of events) listener({ type, machineId, timestamp: Date.now() });
    },
  };
}

test("a mutation finishing after watch restarts cannot repopulate the new view", async () => {
  const fixture = watchedCredentials();
  const views: MachineWebdavCredentialsView[] = [];
  const stop = fixture.api.watch(view => views.push(view));
  await waitFor(() => views.at(-1)?.loading === false);
  let finish!: (value: WebdavCredential & { password: string }) => void;
  fixture.setCreate(() => new Promise(resolve => { finish = resolve; }));
  const pending = fixture.api.create({ name: "Old session" });
  stop();
  fixture.setRecords([]);
  const stopNew = fixture.api.watch(view => views.push(view));
  try {
    assert.deepEqual(views.at(-1), { credentials: [], loading: true, error: null });
    await waitFor(() => !views.at(-1)?.loading && views.at(-1)?.credentials.length === 0);
    finish({ ...credential, password: "one-time-secret" });
    await pending;
    assert.deepEqual(views.at(-1)?.credentials, []);
  } finally { stopNew(); }
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for credentials");
}

test("credential watchers share one subscription and refresh on changes, access changes and session resets", async () => {
  const fixture = watchedCredentials();
  const views: MachineWebdavCredentialsView[] = [];
  const stop = fixture.api.watch(view => views.push(view));
  const stopOther = fixture.api.watch(() => {});
  try {
    assert.deepEqual(views[0], { credentials: [], loading: true, error: null });
    await waitFor(() => views.at(-1)?.loading === false);
    assert.equal(fixture.events.size, 1);
    assert.equal(fixture.requests, 1);
    fixture.emit("webdav_credentials_changed", "other-machine");
    await Promise.resolve();
    assert.equal(fixture.requests, 1);
    const used = { ...credential, lastUsedAt: "2026-10-29T00:01:00Z" };
    fixture.setRecords([used]);
    fixture.emit("webdav_credentials_changed");
    fixture.emit("webdav_credentials_changed");
    await waitFor(() => views.at(-1)?.credentials[0]?.lastUsedAt === used.lastUsedAt);
    assert.equal(fixture.requests, 2);
    fixture.setRecords([]);
    fixture.emit("machine_members_changed");
    await waitFor(() => views.at(-1)?.credentials.length === 0);
    const renamed = { ...used, url: "https://new-host.rool.cloud/" };
    fixture.setRecords([renamed]);
    fixture.emit("machines_changed");
    await waitFor(() => views.at(-1)?.credentials[0]?.url === renamed.url);
    fixture.setRecords([]);
    for (const listener of fixture.events) listener({ type: "session", session: {} } as RoolClientEvent);
    await waitFor(() => views.at(-1)?.credentials.length === 0);
    stopOther();
    assert.equal(fixture.events.size, 1);
  } finally { stop(); stopOther(); }
  assert.equal(fixture.events.size, 0);
  assert.equal(fixture.signals.at(-1)?.aborted, true);
});

test("credential watch clears rows on lost access but keeps them for temporary failures", async () => {
  for (const status of [401, 403, 404, 503, null]) {
    const fixture = watchedCredentials();
    const views: MachineWebdavCredentialsView[] = [];
    const stop = fixture.api.watch(view => views.push(view));
    try {
      await waitFor(() => views.at(-1)?.loading === false);
      const error = status === null ? new Error("offline") : new RoolProblem({
        type: "https://rool.dev/problems/test", title: "Request failed", status,
        code: "test", detail: "Request failed",
      });
      fixture.setLoad(async () => { throw error; });
      fixture.emit("machine_members_changed");
      await waitFor(() => views.at(-1)?.error === error);
      assert.deepEqual(views.at(-1)?.credentials, status !== null && status < 500 ? [] : [credential]);
      fixture.setLoad(async () => [credential]);
      fixture.emit("machine_members_changed");
      await waitFor(() => views.at(-1)?.error === null);
      assert.deepEqual(views.at(-1)?.credentials, [credential]);
    } finally { stop(); }
  }
});

test("credential watch retries failures and never publishes a fetch overtaken by an event or mutation", async () => {
  const fixture = watchedCredentials();
  let attempts = 0;
  fixture.setLoad(async () => {
    if (++attempts === 1) throw new Error("offline");
    return [credential];
  });
  const views: MachineWebdavCredentialsView[] = [];
  const stop = fixture.api.watch(view => views.push(view));
  try {
    await waitFor(() => views.some(view => view.error instanceof Error));
    await waitFor(() => views.at(-1)?.credentials.length === 1);
    assert.equal(views.at(-1)?.error, null);
    let resolve!: (items: WebdavCredential[]) => void;
    fixture.setLoad(() => new Promise(done => { resolve = done; }));
    fixture.emit("webdav_credentials_changed");
    await waitFor(() => !!resolve);
    const start = views.length;
    fixture.setLoad(async () => []);
    await fixture.api.revoke(credential.id);
    resolve([credential]);
    await waitFor(() => fixture.requests >= 4);
    assert.equal(views.slice(start).some(view => view.credentials.length > 0), false);

    // Creation reaches watchers as metadata only, even before the event arrives.
    fixture.setLoad(async () => [credential]);
    const created = await fixture.api.create({ name: credential.name });
    assert.equal(created.password, "one-time-secret");
    await waitFor(() => views.at(-1)?.credentials.length === 1);
    assert.equal(JSON.stringify(views).includes("one-time-secret"), false);
    assert.equal(views.at(-1)?.credentials.some(item => "password" in item), false);

    // An event arriving during a fetch discards that response rather than flashing stale rows.
    let stale!: (items: WebdavCredential[]) => void;
    fixture.setLoad(() => new Promise(done => { stale = done; }));
    fixture.emit("webdav_credentials_changed");
    await waitFor(() => !!stale);
    const beforeEvent = views.length;
    fixture.setLoad(async () => []);
    fixture.emit("webdav_credentials_changed");
    stale([{ ...credential, name: "stale" }]);
    await waitFor(() => views.at(-1)?.credentials.length === 0);
    assert.equal(views.slice(beforeEvent).some(view => view.credentials.some(item => item.name === "stale")), false);
  } finally { stop(); }
});
