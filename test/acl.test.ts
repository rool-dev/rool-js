import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient, RoolProblem, type RoolAcl, type RoolAclView, type RoolClientEvent, type RoolSession } from "../src/index.js";
import { AclClient } from "../src/acl.js";

function answer(allowed = true): RoolAcl {
  return {
    version: 1, actions: { "accounts.create": allowed }, accounts: {},
    machines: { m: { actions: { "machine.members.remove": allowed } } },
  } as unknown as RoolAcl;
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for ACL");
}

function fixture() {
  const listeners = new Set<(event: RoolClientEvent) => void>();
  let calls = 0;
  let load = async (_signal?: AbortSignal) => answer();
  const api = new AclClient({
    load: signal => { calls++; return load(signal); },
    subscribeEvents: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  return {
    api, listeners,
    get calls() { return calls; },
    setLoad(next: typeof load) { load = next; },
    emit(event: RoolClientEvent) { for (const listener of listeners) listener(event); },
  };
}

test("acl.get passes through the authenticated route without caching", async () => {
  let calls = 0;
  const data = { ...answer(), future: true };
  const client = new RoolClient({
    apiUrl: "https://api.example", getAccessToken: () => "token",
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.example/v2/acl");
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
      return Response.json(data);
    },
  });
  assert.deepEqual(await client.acl.get(), data);
  assert.deepEqual(await client.acl.get(), data);
  assert.equal(calls, 2);
});

test("watchers share one fetch and subscription, and ignore generic resource events", async () => {
  const f = fixture();
  const a: RoolAclView[] = [], b: RoolAclView[] = [];
  const stopA = f.api.watch(view => a.push(view));
  const stopB = f.api.watch(view => b.push(view));
  try {
    await waitFor(() => b.at(-1)?.loading === false);
    assert.equal(f.calls, 1);
    assert.equal(f.listeners.size, 1);
    assert.deepEqual(a.at(-1)?.acl, b.at(-1)?.acl);
    f.emit({ type: "account_changed", accountId: "a", timestamp: 1 });
    f.emit({ type: "machines_changed", machineId: "m", timestamp: 1 });
    f.emit({ type: "machine_members_changed", machineId: "m", timestamp: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.calls, 1);
    f.setLoad(async () => answer(false));
    f.emit({ type: "acl_changed", timestamp: 2 });
    f.emit({ type: "acl_changed", timestamp: 3 });
    assert.equal(b.at(-1)?.acl, null);
    await waitFor(() => b.at(-1)?.loading === false);
    assert.equal(f.calls, 2);
    assert.equal(b.at(-1)?.acl?.machines.m.actions["machine.members.remove"], false);
    assert.equal(b.at(-1)?.acl?.actions["accounts.create"], false);
    stopA();
    assert.equal(f.listeners.size, 1);
  } finally { stopA(); stopB(); }
  assert.equal(f.listeners.size, 0);
});

test("an event during a fetch prevents its older answer from being published", async () => {
  const f = fixture();
  let finish!: (acl: RoolAcl) => void;
  f.setLoad(() => new Promise(resolve => { finish = resolve; }));
  const views: RoolAclView[] = [];
  const stop = f.api.watch(view => views.push(view));
  try {
    await waitFor(() => !!finish);
    f.setLoad(async () => answer(false));
    f.emit({ type: "acl_changed", timestamp: 1 });
    finish(answer(true));
    await waitFor(() => views.at(-1)?.loading === false);
    assert.equal(f.calls, 2);
    assert.ok(views.every(view => view.acl?.machines.m.actions["machine.members.remove"] !== true));
  } finally { stop(); }
});

test("failed ACL reads clear old grants and retry automatically", async () => {
  const f = fixture();
  const views: RoolAclView[] = [];
  const stop = f.api.watch(view => views.push(view));
  try {
    await waitFor(() => views.at(-1)?.loading === false);
    const error = new Error("offline");
    f.setLoad(async () => { throw error; });
    f.emit({ type: "acl_changed", timestamp: 1 });
    await waitFor(() => views.at(-1)?.error === error);
    assert.equal(views.at(-1)?.acl, null);
    f.setLoad(async () => answer(false));
    await waitFor(() => views.at(-1)?.acl !== null);
    assert.equal(views.at(-1)?.error, null);
  } finally { stop(); }
});

test("stopping aborts work and a later watch cannot receive the old user's answer", async () => {
  const f = fixture();
  let finish!: (acl: RoolAcl) => void;
  let signal: AbortSignal | undefined;
  f.setLoad(s => { signal = s; return new Promise(resolve => { finish = resolve; }); });
  const stop = f.api.watch(() => {});
  await waitFor(() => !!finish);
  stop();
  assert.equal(signal?.aborted, true);
  f.setLoad(async () => answer(false));
  const views: RoolAclView[] = [];
  const stopNext = f.api.watch(view => views.push(view));
  try {
    finish(answer(true));
    await waitFor(() => views.at(-1)?.loading === false);
    assert.ok(views.every(view => view.acl?.machines.m.actions["machine.members.remove"] !== true));
  } finally { stopNext(); }
});

test("session recovery refetches ACL", async () => {
  const f = fixture();
  const views: RoolAclView[] = [];
  const stop = f.api.watch(view => views.push(view));
  try {
    await waitFor(() => views.at(-1)?.loading === false);
    f.setLoad(async () => answer(false));
    f.emit({ type: "session", session: {} as RoolSession });
    assert.equal(views.at(-1)?.acl, null);
    await waitFor(() => views.at(-1)?.loading === false);
    assert.equal(f.calls, 2);
  } finally { stop(); }
});

test("the real event poll drives ACL changes and cursor resets, not mutation responses or refusals", async () => {
  let aclCalls = 0, sessions = 0;
  let reply: ((response: Response) => void) | null = null;
  let data = answer();
  const client = new RoolClient({
    apiUrl: "https://api.example",
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v2/acl") { aclCalls++; return Response.json(data); }
      if (path === "/v2/session") return Response.json({ syncToken: `session-${++sessions}` });
      if (path === "/v2/events") return new Promise((resolve, reject) => {
        reply = response => { reply = null; resolve(response); };
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ type: "about:blank", title: "Forbidden", status: 403, code: "forbidden", detail: "Refused" }, { status: 403 });
    },
  });
  const views: RoolAclView[] = [];
  const stop = client.acl.watch(view => views.push(view));
  try {
    await waitFor(() => !!reply && views.at(-1)?.loading === false);
    const before = aclCalls;
    await client.machine("m").members.remove("u");
    await assert.rejects(client.getAccount("a"), RoolProblem);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(aclCalls, before);
    data = answer(false);
    reply!(Response.json({ syncToken: "after-change", events: [{ type: "acl_changed", timestamp: 1 }] }));
    await waitFor(() => views.at(-1)?.acl?.machines.m.actions["machine.members.remove"] === false);
    await waitFor(() => !!reply);
    data = answer(true);
    reply!(new Response(null, { status: 409 }));
    await waitFor(() => sessions === 2 && views.at(-1)?.acl?.machines.m.actions["machine.members.remove"] === true);
  } finally { stop(); }
});
