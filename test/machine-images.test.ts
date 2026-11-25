import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoolAccountApi,
  RoolClient,
  type AccountMachineImagesView,
  type MachineImageStateView,
  type RoolClientEvent,
  type HubMachineImage,
  type MachineImage,
  type MachineImageState,
} from "../src/index.js";
import { RoolMachine, type RoolMachineTransport } from "../src/machine.js";

function recordingClient(reply: (path: string, method: string) => unknown) {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      requests.push({ path, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const body = reply(path, method);
      return body === undefined ? new Response(null, { status: 204 }) : Response.json(body);
    },
  });
  return { client, requests };
}

const machineImage: MachineImage = {
  id: "img/1", name: "Data", description: "For data work.", defaultRevision: 1,
  copiedFromId: "hub1", copiedFromPublishedRevision: 2, publishedRevision: null,
  revisions: [{
    revision: 1, stepCount: 2, fileCount: 0, parentRevision: null, createdAt: "2026-11-25T10:00:00.000Z", createdBy: "user",
    machines: 1, copiedFromRevision: 1, review: null,
  }],
};

test("an account lists its machine images and copies one from the Hub", async () => {
  const { client, requests } = recordingClient((_path, method) =>
    method === "GET" ? { machineImages: [machineImage] } : { id: "new", name: "Data (2)" });
  const machineImages = client.account("acc/1").machineImages;
  assert.deepEqual(await machineImages.list(), [machineImage]);
  assert.deepEqual(await machineImages.copyFromHub("hub1"), { id: "new", name: "Data (2)" });
  assert.deepEqual(requests, [
    { path: "/v2/accounts/acc%2F1/machine-images", method: "GET", body: undefined },
    { path: "/v2/accounts/acc%2F1/machine-images", method: "POST", body: { from: "hub1" } },
  ]);
});

test("a machine image is changed, published and updated through its own paths", async () => {
  const { client, requests } = recordingClient((path, method) => {
    if (method === "DELETE") return undefined;
    if (path.endsWith("/default-revision")) return { previous: 1, restarted: 3 };
    if (path.endsWith("/submissions")) return { id: "sub", revision: 2 };
    if (path.endsWith("/copy-update")) return { revision: 3, copiedFromRevision: 2 };
    return { ...machineImage, name: "Renamed" };
  });
  const image = client.machineImage("img/1");
  assert.equal((await image.get()).name, "Renamed");
  await image.getRevision(2);
  assert.equal((await image.update({ name: "Renamed" })).id, machineImage.id);
  assert.deepEqual(await image.setDefaultRevision(2), { previous: 1, restarted: 3 });
  assert.deepEqual(await image.submit(), { id: "sub", revision: 2 });
  await image.submit(2);
  assert.deepEqual(await image.updateCopy(), { revision: 3, copiedFromRevision: 2 });
  await image.unlist();
  await image.delete();
  const base = "/v2/machine-images/img%2F1";
  assert.deepEqual(requests, [
    { path: base, method: "GET", body: undefined },
    { path: `${base}/revisions/2`, method: "GET", body: undefined },
    { path: base, method: "PATCH", body: { name: "Renamed" } },
    { path: `${base}/default-revision`, method: "PUT", body: { revision: 2 } },
    { path: `${base}/submissions`, method: "POST", body: {} },
    { path: `${base}/submissions`, method: "POST", body: { revision: 2 } },
    { path: `${base}/copy-update`, method: "POST", body: undefined },
    { path: `${base}/listing`, method: "DELETE", body: undefined },
    { path: base, method: "DELETE", body: undefined },
  ]);
  assert.throws(() => client.machineImage(""), /machineImageId is required/);
});

test("the Hub lists machine images and shows one", async () => {
  const listed: HubMachineImage = { id: "hub/1", name: "Data", description: "For data work.", revision: 2, stepCount: 1, fileCount: 0, publishedAt: "2026-11-25T10:00:00.000Z" };
  const { client, requests } = recordingClient((path) =>
    path === "/v2/hub/machine-images" ? { machineImages: [listed] } : { ...listed, recipe: [{ run: "apt-get install -y r-base" }], files: [] });
  assert.equal(client.hub, client.hub);
  assert.deepEqual(await client.hub.machineImages.list(), [listed]);
  assert.deepEqual((await client.hub.machineImages.get("hub/1")).recipe, [{ run: "apt-get install -y r-base" }]);
  assert.deepEqual(requests.map((r) => r.path), ["/v2/hub/machine-images", "/v2/hub/machine-images/hub%2F1"]);
});

test("a machine reads and changes the machine image it runs", async () => {
  const state: MachineImageState = {
    machineImage: { id: "img", name: "Data", revision: 2, defaultRevision: 2 }, editing: false, changing: true, error: null, bootFailure: null, editRefusal: null,
  };
  const { client, requests } = recordingClient((_path, method) => (method === "GET" ? state : { message: "ok" }));
  const api = client.machine("m/1").machineImage;
  assert.deepEqual(await api.get(), state);
  await api.use("img");
  await api.use(null);
  await api.startEditing();
  await api.save();
  await api.saveAs({ name: "Data", description: "For data work." });
  await api.discardEdits();
  const base = "/v2/machines/m%2F1/machine-image";
  assert.deepEqual(requests, [
    { path: base, method: "GET", body: undefined },
    { path: base, method: "PUT", body: { machineImageId: "img" } },
    { path: base, method: "PUT", body: { machineImageId: null } },
    { path: `${base}/edit`, method: "POST", body: undefined },
    { path: `${base}/save`, method: "POST", body: {} },
    { path: `${base}/save`, method: "POST", body: { name: "Data", description: "For data work." } },
    { path: `${base}/discard`, method: "POST", body: undefined },
  ]);
});

test("a machine image watch re-reads on its machine's changes and stops when asked", async () => {
  const events = new Set<(event: RoolClientEvent) => void>();
  let state: MachineImageState = { machineImage: null, editing: false, changing: true, error: null, bootFailure: null, editRefusal: "plan" };
  let requests = 0;
  const machine = new RoolMachine("m1", {
    send: async () => { throw new Error("Unexpected send"); },
    request: async () => new Response(null, { status: 204 }),
    requestJson: async <T>(path: string): Promise<T> => {
      assert.equal(path, "/v2/machines/m1/machine-image");
      requests++;
      return state as T;
    },
    subscribeEvents: (listener) => { events.add(listener); return () => { events.delete(listener); }; },
    deleted: () => {},
  } satisfies RoolMachineTransport);
  const emit = (machineId: string) => { for (const listener of events) listener({ type: "machines_changed", machineId, timestamp: Date.now() }); };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const views: MachineImageStateView[] = [];
  const stop = machine.machineImage.watch((view) => views.push(view));
  assert.deepEqual(views[0], { state: null, loading: true, error: null });
  await settle();
  assert.equal(views.at(-1)?.state?.changing, true);

  emit("other");
  await settle();
  assert.equal(requests, 1);

  state = { ...state, changing: false, machineImage: { id: "img", name: "Data", revision: 1, defaultRevision: 1 } };
  emit("m1");
  await settle();
  assert.equal(requests, 2);
  assert.deepEqual(views.at(-1), { state, loading: false, error: null });

  stop();
  assert.equal(events.size, 0);
});

test("an account's machine image watch re-reads on that account's changes and is shared", async () => {
  const events = new Set<(event: RoolClientEvent) => void>();
  let saved: MachineImage[] = [];
  let requests = 0;
  const account = new RoolAccountApi("acc", {
    request: async () => new Response(null, { status: 204 }),
    requestJson: async <T>(path: string): Promise<T> => {
      assert.equal(path, "/v2/accounts/acc/machine-images");
      requests++;
      return { machineImages: saved } as T;
    },
    subscribeEvents: (listener) => { events.add(listener); return () => { events.delete(listener); }; },
  });
  const emit = (accountId: string) => { for (const listener of events) listener({ type: "account_changed", accountId, timestamp: Date.now() }); };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const views: AccountMachineImagesView[] = [];
  const stop = account.machineImages.watch((view) => views.push(view));
  const stopOther = account.machineImages.watch(() => {});
  assert.deepEqual(views[0], { machineImages: [], loading: true, error: null });
  await settle();
  assert.equal(requests, 1);

  emit("other");
  await settle();
  assert.equal(requests, 1);

  saved = [machineImage];
  emit("acc");
  await settle();
  assert.equal(requests, 2);
  assert.deepEqual(views.at(-1), { machineImages: [machineImage], loading: false, error: null });

  stop();
  stopOther();
  assert.equal(events.size, 0);
});

test("the client hands out one handle per account", () => {
  const client = new RoolClient({ apiUrl: "https://api.example.test" });
  assert.equal(client.account("acc"), client.account("acc"));
  assert.notEqual(client.account("acc"), client.account("other"));
});

test("a machine's theme, icon and instructions are each written on their own", async () => {
  const { client, requests } = recordingClient((path, method) => {
    if (path.endsWith("/theme")) return { theme: { mode: "dark" } };
    if (path.endsWith("/icon")) return { icon: null };
    return { instructions: method === "GET" ? "Be brief." : "Answer in Danish." };
  });
  const settings = client.machine("m/1").settings;
  assert.deepEqual(await settings.setTheme({ mode: "dark" }), { mode: "dark" });
  assert.equal(await settings.setIcon(null), null);
  assert.equal(await settings.getInstructions(), "Be brief.");
  assert.equal(await settings.setInstructions("Answer in Danish."), "Answer in Danish.");
  const base = "/v2/machines/m%2F1";
  assert.deepEqual(requests, [
    { path: `${base}/theme`, method: "PUT", body: { theme: { mode: "dark" } } },
    { path: `${base}/icon`, method: "PUT", body: { icon: null } },
    { path: `${base}/instructions`, method: "GET", body: undefined },
    { path: `${base}/instructions`, method: "PUT", body: { instructions: "Answer in Danish." } },
  ]);
});
