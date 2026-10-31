import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient, type RoolClientEvent, type EmailAccessAddress, type EmailAccessView } from "../src/index.js";
import { EmailAccessClient } from "../src/email-access.js";

const address: EmailAccessAddress = {
  id: "address/one", email: "other@example.com", createdAt: "2026-10-31T09:00:00.000Z",
  confirmedAt: null, expiresAt: "2026-10-31T09:10:00.000Z",
};

test("email access uses authenticated user routes and unwraps the list", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example",
    getAccessToken: async () => "token",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return Response.json(address);
      return Response.json({ addresses: [address] });
    },
  });
  const api = client.emailAccess;
  assert.deepEqual(await api.list(), [address]);
  assert.deepEqual(await api.requestConfirmation(address.email), address);
  await api.remove(address.id);
  assert.deepEqual(requests.map(request => request.url), [
    "https://api.example/v2/me/email-access",
    "https://api.example/v2/me/email-access",
    "https://api.example/v2/me/email-access/address%2Fone",
  ]);
  assert.equal(requests[1].init?.body, JSON.stringify({ email: address.email }));
  assert.equal(new Headers(requests[1].init?.headers).get("Content-Type"), "application/json");
});

function watchedAddresses() {
  const events = new Set<(event: RoolClientEvent) => void>();
  let records = [address];
  let request = async () => { records = [address]; return address; };
  let requests = 0;
  const api = new EmailAccessClient({
    request: async () => { records = []; return new Response(null, { status: 204 }); },
    requestJson: async <T>(_path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === "POST") return await request() as T;
      requests++;
      return { addresses: records } as T;
    },
    subscribeEvents: listener => { events.add(listener); return () => { events.delete(listener); }; },
  });
  return {
    api,
    get requests() { return requests; },
    setRecords: (next: EmailAccessAddress[]) => { records = next; },
    setRequest: (next: typeof request) => { request = next; },
    emit: (event: RoolClientEvent) => { for (const listener of events) listener(event); },
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for email access");
}

test("the email event refreshes confirmation, and local mutations update the watched list", async () => {
  const fixture = watchedAddresses();
  const views: EmailAccessView[] = [];
  const stop = fixture.api.watch(view => views.push(view));
  try {
    await waitFor(() => views.at(-1)?.loading === false);
    fixture.emit({ type: "profile_changed", timestamp: 1 });
    await Promise.resolve();
    assert.equal(fixture.requests, 1);
    const confirmed = { ...address, confirmedAt: "2026-10-31T09:01:00Z", expiresAt: null };
    fixture.setRecords([confirmed]);
    fixture.emit({ type: "email_access_changed", timestamp: 2 });
    await waitFor(() => views.at(-1)?.addresses[0]?.confirmedAt === confirmed.confirmedAt);
    await fixture.api.remove(address.id);
    assert.deepEqual(views.at(-1)?.addresses, []);
    await fixture.api.requestConfirmation(address.email);
    await fixture.api.requestConfirmation(address.email);
    assert.deepEqual(views.at(-1)?.addresses, [address]);
  } finally { stop(); }
});

test("a request finishing after watch restarts cannot populate the new session's view", async () => {
  const fixture = watchedAddresses();
  const views: EmailAccessView[] = [];
  const stop = fixture.api.watch(view => views.push(view));
  await waitFor(() => views.at(-1)?.loading === false);
  let finish!: (value: EmailAccessAddress) => void;
  fixture.setRequest(() => new Promise(resolve => { finish = resolve; }));
  const pending = fixture.api.requestConfirmation(address.email);
  stop();
  fixture.setRecords([]);
  const stopNew = fixture.api.watch(view => views.push(view));
  try {
    await waitFor(() => views.at(-1)?.loading === false);
    finish(address);
    await pending;
    assert.deepEqual(views.at(-1)?.addresses, []);
  } finally { stopNew(); }
});
