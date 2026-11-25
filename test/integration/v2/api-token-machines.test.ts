import assert from "node:assert/strict";
import test from "node:test";
import { RoolClient } from "../../../src/index.js";
import { NodeAuth } from "../../../src/auth-node.js";

const apiUrl = process.env.ROOL_TEST_API_URL ?? "http://localhost:1357";
if (!["localhost", "127.0.0.1"].includes(new URL(apiUrl).hostname)) throw new Error("Local API only");

test("local machine operations enforce API token grants and guest identities", { timeout: 180_000 }, async () => {
  const auth = new NodeAuth({ apiUrl, authUrl: process.env.ROOL_TEST_AUTH_URL, profile: process.env.ROOL_TEST_AUTH_PROFILE ?? "sdk-v2-primary" });
  const human = new RoolClient({ apiUrl, getTokens: auth.getTokens });
  const created = await human.createMachine({ name: `SDK token smoke ${Date.now()}` });
  const management = human.account(created.accountId).apiTokens;
  const ids: string[] = [];
  let siblingId: string | undefined;
  let createdSibling = false;
  try {
    siblingId = (await human.listMachines()).find(machine => machine.id !== created.id)?.id;
    if (!siblingId) {
      siblingId = (await human.createMachine({ name: `SDK token scope ${Date.now()}` })).id;
      createdSibling = true;
    }
    const full = await management.create({ name: "Machine smoke", grants: [{ machineId: created.id, actions: [
      "machine.read", "machine.files.read", "machine.files.write", "machine.exec", "machine.checkpoints.read",
    ] }] });
    ids.push(full.id);
    const readOnly = await management.create({ name: "Read-only smoke", grants: [{ machineId: created.id, actions: ["machine.read", "machine.files.read"] }] });
    ids.push(readOnly.id);
    const client = new RoolClient({ apiUrl, apiToken: full.token });
    const machine = client.machine(created.id);
    const reader = new RoolClient({ apiUrl, apiToken: readOnly.token }).machine(created.id);
    assert.equal((await machine.get()).id, created.id);
    assert(Array.isArray(await machine.checkpoints.list()));
    console.log("summary and checkpoints: OK");

    const identity = await machine.exec({ command: "id -u" });
    assert.equal(identity.exitCode, 0);
    const humanIdentity = await human.machine(created.id).exec({ command: "id -u" });
    assert.notEqual(identity.stdout.trim(), humanIdentity.stdout.trim());
    console.log(`exec: OK, separate token UID ${identity.stdout.trim()} and human UID ${humanIdentity.stdout.trim()}`);

    const path = "/rool-drive/api-token-smoke.txt";
    await machine.files.write(path, "token payload\n", { contentType: "text/plain" });
    assert.equal(await (await machine.files.read(path)).text(), "token payload\n");
    assert.equal(await (await reader.files.read(path)).text(), "token payload\n");
    const command = await machine.exec({ command: `cat ${path}; printf 'stderr test' >&2; exit 7` });
    assert.equal(command.stdout, "token payload\n");
    assert.equal(command.stderr, "stderr test");
    assert.equal(command.exitCode, 7);
    console.log("file write/read and exec stdout/stderr/exit: OK");

    await assert.rejects(() => reader.files.write(path, "forbidden"), { status: 403 });
    await assert.rejects(() => reader.exec({ command: "true" }), { status: 403 });
    await assert.rejects(() => machine.settings.replace({ name: "forbidden" }), { status: 403 });
    await assert.rejects(() => client.machine(siblingId!).get(), { status: 403 });
    assert.equal(await (await machine.files.read(path)).text(), "token payload\n");
    console.log("read-only, missing-grant and other-machine denials: OK");

    await machine.files.delete(path);
    await assert.rejects(() => machine.files.read(path), { status: 404 });
    await management.revoke(full.id);
    await assert.rejects(() => machine.get(), { status: 401 });
    await assert.rejects(() => machine.exec({ command: "true" }), { status: 401 });
    console.log("file deletion and revoked-token rejection: OK");
  } finally {
    for (const id of ids) await management.revoke(id);
    await human.machine(created.id).delete();
    if (createdSibling && siblingId) await human.machine(siblingId).delete();
  }
});
