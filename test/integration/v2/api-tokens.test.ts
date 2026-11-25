import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient, type ApiTokensView } from "../../../src/index.js";
import { NodeAuth } from "../../../src/auth-node.js";

const apiUrl = process.env.ROOL_TEST_API_URL ?? "http://localhost:1357";
if (!["localhost", "127.0.0.1"].includes(new URL(apiUrl).hostname)) throw new Error("Local API only");

test("local grant discovery and cross-client token watcher", { timeout: 30_000 }, async () => {
  const auth = new NodeAuth({ apiUrl, authUrl: process.env.ROOL_TEST_AUTH_URL, profile: process.env.ROOL_TEST_AUTH_PROFILE ?? "sdk-v2-primary" });
  const client = new RoolClient({ apiUrl, getTokens: auth.getTokens });
  const writer = new RoolClient({ apiUrl, getTokens: auth.getTokens });
  const session = await client.getSession();
  const accountId = session.accounts[0].id;
  const account = client.account(accountId);
  const actions = await account.getGrantableActions();
  assert(actions.some(action => action.id === "account.read" && action.description));
  assert(!actions.some(action => action.id === "account.tokens.write"));
  const machine = session.machines.find(machine => machine.accountId === accountId);
  if (machine) {
    const scoped = await account.getGrantableActions({ machineId: machine.id });
    assert(scoped.length > 0);
    assert(scoped.every(action => action.id.startsWith("machine.")));
  }
  let view: ApiTokensView | undefined;
  const snapshots: ApiTokensView[] = [];
  const stop = account.apiTokens.watch(next => { view = next; snapshots.push(next); });
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 8_000;
    while (!predicate()) {
      if (view?.error) throw view.error;
      if (Date.now() > deadline) throw new Error("Token watch timed out");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  let id: string | undefined;
  try {
    await until(() => !!view && !view.loading);
    const created = await writer.account(accountId).apiTokens.create({ name: "SDK local watch smoke", grants: [{ machineId: null, actions: ["account.read"] }] });
    id = created.id;
    await until(() => !!view?.tokens.some(token => token.id === id));
    await writer.account(accountId).apiTokens.rename(id, "SDK renamed");
    await until(() => !!view?.tokens.some(token => token.id === id && token.name === "SDK renamed"));
    const tokenClient = new RoolClient({ apiUrl, apiToken: created.token });
    await tokenClient.account(accountId).get();
    await until(() => !!view?.tokens.some(token => token.id === id && token.lastUsedAt !== null));
    await assert.rejects(() => tokenClient.account(accountId).getGrantableActions(), { status: 403 });
    await writer.account(accountId).apiTokens.revoke(id);
    await until(() => !!view && !view.loading && !view.tokens.some(token => token.id === id));
    for (const snapshot of snapshots) for (const token of snapshot.tokens) {
      assert(!("secret" in token));
      assert(!("token" in token));
    }
  } finally {
    stop();
    if (id) await writer.account(accountId).apiTokens.revoke(id);
  }
});
