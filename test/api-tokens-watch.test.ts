import assert from "node:assert/strict";
import test from "node:test";
import { RoolAccountApi } from "../src/account.js";
import type { ApiToken, ApiTokensView, RoolClientEvent } from "../src/index.js";

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test("token watches share loads, scope events, clear stale permissions and unsubscribe", async t => {
  let listener: ((event: RoolClientEvent) => void) | undefined;
  let loads = 0;
  let subscriptions = 0;
  let failure: Error | undefined;
  const tokens: ApiToken[] = [{ id: "token", name: "CI", createdByUserId: null, createdAt: "now", lastUsedAt: null, grants: [] }];
  const api = new RoolAccountApi("account", {
    request: async () => new Response(null, { status: 204 }),
    requestJson: async <T>() => {
      loads++;
      if (failure) throw failure;
      return { tokens } as T;
    },
    subscribeEvents: next => { subscriptions++; listener = next; return () => { listener = undefined; }; },
  }).apiTokens;
  const views: ApiTokensView[] = [];
  const stop = api.watch(view => views.push(view));
  const second = api.watch(() => {});
  t.after(() => { stop(); second(); });
  await tick();
  assert.equal(subscriptions, 1);
  assert.equal(loads, 1);
  assert.deepEqual(views.at(-1)?.tokens, tokens);
  listener!({ type: "api_tokens_changed", accountId: "other", timestamp: 1 });
  await tick();
  assert.equal(loads, 1);
  listener!({ type: "api_tokens_changed", accountId: "account", timestamp: 2 });
  await tick();
  assert.equal(loads, 2);
  failure = new Error("permissions lost");
  listener!({ type: "acl_changed", timestamp: 3 });
  await tick();
  assert.deepEqual(views.at(-1)?.tokens, []);
  assert.equal(views.at(-1)?.error, failure);
  failure = undefined;
  listener!({ type: "account_changed", accountId: "account", timestamp: 4 });
  await tick();
  assert.deepEqual(views.at(-1)?.tokens, tokens);
  stop();
  assert(listener);
  second();
  assert.equal(listener, undefined);
});

test("grant discovery uses account scope and URL-encoded machine scope", async () => {
  const paths: string[] = [];
  const actions = [{ id: "future.action", description: "A server-defined action" }];
  const account = new RoolAccountApi("account/one", {
    request: async () => new Response(),
    requestJson: async <T>(path: string) => { paths.push(path); return { actions } as T; },
    subscribeEvents: () => () => {},
  });
  assert.deepEqual(await account.getGrantableActions(), actions);
  assert.deepEqual(await account.getGrantableActions({ machineId: "machine/one" }), actions);
  assert.deepEqual(paths, [
    "/v2/accounts/account%2Fone/grantable-actions",
    "/v2/accounts/account%2Fone/grantable-actions?machineId=machine%2Fone",
  ]);
});
