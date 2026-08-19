/**
 * Local integration test for the SDK member and invite API.
 */

import assert from "node:assert/strict";
import type { MachineInvite, MachineMember } from "../../../src/index.js";
import { assertIsoDate, expectProblem } from "./assertions.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";

const ownerClient = createTestClient("primary");
const memberClient = createTestClient("member");
const publicClient = createTestClient(null);
const machineCleanup = new MachineCleanup(ownerClient);

function assertMember(member: MachineMember): void {
  assert.equal(typeof member.userId, "string");
  assert.equal(typeof member.email, "string");
  assert(member.name === null || typeof member.name === "string");
  assert(["owner", "admin", "editor", "viewer"].includes(member.role));
  assert(member.photoUrl === null || typeof member.photoUrl === "string");
}

function assertInvite(invite: MachineInvite): void {
  assert.equal(typeof invite.id, "string");
  assert(["admin", "editor", "viewer"].includes(invite.role));
  assert(invite.email === null || typeof invite.email === "string");
  assert.equal(typeof invite.createdById, "string");
  assertIsoDate(invite.createdAt);
  assertIsoDate(invite.expiresAt);
  assert(invite.maxUses === null || Number.isInteger(invite.maxUses));
  assert(Number.isInteger(invite.useCount));
}

function assertListedInvite(invite: MachineInvite): void {
  assertInvite(invite);
  assert.deepEqual(Object.keys(invite).sort(), [
    "createdAt",
    "createdById",
    "email",
    "expiresAt",
    "id",
    "maxUses",
    "role",
    "useCount",
  ]);
}

async function main(): Promise<void> {
  await requireLocalProxy();

  const owner = await ownerClient.getAccount();
  const member = await memberClient.getAccount();
  const ownerProfile = await ownerClient.getProfile();
  const memberProfile = await memberClient.getProfile();
  assert.notEqual(
    owner.id,
    member.id,
    "member token must belong to another user",
  );
  const machine = machineCleanup.track(
    await ownerClient.createMachine({
      name: `SDK member routes ${Date.now()}`,
    }),
  );
  const ownerMachine = ownerClient.machine(machine.id);
  const memberMachine = memberClient.machine(machine.id);

  console.log("Creating and listing a machine invite...");
  const invite = await ownerMachine.invites.create({
    role: "editor",
    expiresInDays: 1,
    maxUses: 2,
  });
  assertInvite(invite);
  assert.equal(invite.createdById, owner.id);
  assert.equal(invite.role, "editor");
  assert.equal(invite.maxUses, 2);
  assert.equal(invite.emailStatus, null);

  const emailInvite = await ownerMachine.invites.create({
    role: "viewer",
    email: member.email,
    expiresInDays: 1,
  });
  assertInvite(emailInvite);
  assert.equal(emailInvite.email, member.email);
  assert.equal(emailInvite.maxUses, 1);
  assert.notEqual(emailInvite.emailStatus, null);

  const listedInvites = await ownerMachine.invites.list();
  assert.equal(listedInvites.length, 2);
  listedInvites.forEach(assertListedInvite);
  assert(listedInvites.some((item) => item.id === invite.id));
  assert(listedInvites.some((item) => item.id === emailInvite.id));

  const token = new URL(invite.url).pathname.split("/").at(-1);
  const emailToken = new URL(emailInvite.url).pathname.split("/").at(-1);
  assert(token, "created invite URL should contain its token");
  assert(emailToken, "email invite URL should contain its token");
  const preview = await publicClient.getInvitePreview(token);
  assert.equal(preview.machineId, machine.id);
  assert.equal(preview.machineName, machine.name);
  assert.equal(preview.role, "editor");
  assert.equal(preview.email, null);
  const emailPreview = await publicClient.getInvitePreview(emailToken);
  assert.equal(emailPreview.machineId, machine.id);
  assert.equal(emailPreview.email, member.email);
  await ownerMachine.invites.revoke(emailInvite.id);

  console.log("Redeeming the invite and replacing the member role...");
  assert.deepEqual(await memberClient.redeemInvite(token), {
    machineId: machine.id,
    role: "editor",
    status: "joined",
  });

  const members = await ownerMachine.members.list();
  members.forEach(assertMember);
  assert.equal(members.length, 2);
  const listedOwner = members.find((item) => item.userId === owner.id);
  const listedMember = members.find((item) => item.userId === member.id);
  assert.equal(listedOwner?.name, ownerProfile.name);
  assert.equal(listedOwner?.role, "owner");
  assert.equal(listedMember?.name, memberProfile.name);
  assert.equal(listedMember?.role, "editor");
  assert.deepEqual(await ownerMachine.members.getRole(member.id), {
    role: "editor",
  });
  assert.deepEqual(
    await ownerMachine.members.replaceRole(member.id, { role: "viewer" }),
    { role: "viewer" },
  );
  assert.deepEqual(await memberMachine.members.getRole(member.id), {
    role: "viewer",
  });
  await expectProblem(
    () => ownerMachine.members.replaceRole("missing-user", { role: "editor" }),
    404,
    "not_found",
  );
  await expectProblem(
    () => ownerMachine.members.replaceRole(member.id, { role: "owner" }),
    409,
    "role_not_replaceable",
  );
  await expectProblem(
    () => ownerMachine.members.remove(owner.id),
    409,
    "membership_not_removable",
  );

  console.log("Leaving the machine and revoking the invite...");
  await memberMachine.members.remove(member.id);
  assert.deepEqual(
    (await ownerMachine.members.list()).map((item) => item.userId),
    [owner.id],
  );

  await ownerMachine.invites.revoke(invite.id);
  assert.deepEqual(await ownerMachine.invites.list(), []);
  await expectProblem(
    () => publicClient.getInvitePreview(token),
    410,
    "invite_revoked",
  );

  await ownerMachine.delete();
  machineCleanup.forget(machine.id);
  console.log("\n✅ SDK member and invite route smoke tests passed.");
}

runSmokeTest(main, () => machineCleanup.cleanup());
