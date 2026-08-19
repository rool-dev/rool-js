/**
 * Local integration test for SDK account event long polling.
 */

import assert from "node:assert/strict";
import type {
  RoolClientEvent,
  UserAppData,
  UserProfile,
} from "../../../src/index.js";
import {
  createTestClient,
  MachineCleanup,
  requireLocalProxy,
  runSmokeTest,
} from "./harness.js";

const USER_APP_DATA_KEY = "__sdk_event_smoke__";
const ownerClient = createTestClient("primary");
const memberClient = createTestClient("member");
const machineCleanup = new MachineCleanup(ownerClient);
let originalUserAppData: UserAppData | null = null;
let originalProfile: UserProfile | null = null;
let unsubscribeOwner = () => {};
let unsubscribeMember = () => {};

function eventQueue(
  subscribe: (listener: (event: RoolClientEvent) => void) => () => void,
): {
  next(): Promise<RoolClientEvent>;
  unsubscribe(): void;
} {
  const events: RoolClientEvent[] = [];
  const waiters: Array<{
    resolve(event: RoolClientEvent): void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];
  const unsubscribe = subscribe((event) => {
    const waiter = waiters.shift();
    if (!waiter) {
      events.push(event);
      return;
    }
    clearTimeout(waiter.timeout);
    waiter.resolve(event);
  });

  return {
    next: () => {
      const event = events.shift();
      if (event) return Promise.resolve(event);

      return new Promise<RoolClientEvent>((resolve, reject) => {
        const waiter = {
          resolve,
          timeout: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error("Timed out waiting for an SDK event"));
          }, 10_000),
        };
        waiters.push(waiter);
      });
    },
    unsubscribe,
  };
}

function assertMachineEvent(
  event: RoolClientEvent,
  type: "machines_changed" | "machine_members_changed",
  machineId: string,
): void {
  assert.equal(event.type, type);
  if (
    event.type === "machines_changed" ||
    event.type === "machine_members_changed"
  ) {
    assert.equal(event.machineId, machineId);
    assert.equal(typeof event.timestamp, "number");
  }
}

async function main(): Promise<void> {
  await requireLocalProxy();

  const ownerEvents = eventQueue((listener) =>
    ownerClient.events.subscribe(listener),
  );
  unsubscribeOwner = ownerEvents.unsubscribe;

  const initial = await ownerEvents.next();
  assert.equal(initial.type, "session");
  if (initial.type !== "session") throw new Error("unreachable");
  assert.equal(initial.session.account.id, (await ownerClient.getAccount()).id);

  originalUserAppData = await ownerClient.getUserAppData();
  await ownerClient.setUserAppData(USER_APP_DATA_KEY, Date.now());
  const appDataEvent = await ownerEvents.next();
  assert.equal(appDataEvent.type, "user_app_data_changed");

  originalProfile = await ownerClient.getProfile();
  await ownerClient.replaceProfile({
    ...originalProfile,
    name: `SDK event smoke ${Date.now()}`,
  });
  const profileEvent = await ownerEvents.next();
  assert.equal(profileEvent.type, "profile_changed");

  const machine = machineCleanup.track(
    await ownerClient.createMachine({ name: `SDK events ${Date.now()}` }),
  );
  assertMachineEvent(await ownerEvents.next(), "machines_changed", machine.id);

  const memberEvents = eventQueue((listener) =>
    memberClient.events.subscribe(listener),
  );
  unsubscribeMember = memberEvents.unsubscribe;
  assert.equal((await memberEvents.next()).type, "session");

  const ownerMachine = ownerClient.machine(machine.id);
  const memberMachine = memberClient.machine(machine.id);
  const invite = await ownerMachine.invites.create({
    role: "editor",
    maxUses: 1,
  });
  const token = new URL(invite.url).pathname.split("/").at(-1);
  assert(token);
  await memberClient.redeemInvite(token);

  for (const events of [ownerEvents, memberEvents]) {
    const membershipEvents = [await events.next(), await events.next()].sort(
      (left, right) => left.type.localeCompare(right.type),
    );
    assertMachineEvent(
      membershipEvents[0],
      "machine_members_changed",
      machine.id,
    );
    assertMachineEvent(membershipEvents[1], "machines_changed", machine.id);
  }

  const member = await memberClient.getAccount();
  await memberMachine.members.remove(member.id);
  const ownerMembershipEvents = [
    await ownerEvents.next(),
    await ownerEvents.next(),
  ].sort((left, right) => left.type.localeCompare(right.type));
  assertMachineEvent(
    ownerMembershipEvents[0],
    "machine_members_changed",
    machine.id,
  );
  assertMachineEvent(ownerMembershipEvents[1], "machines_changed", machine.id);
  assertMachineEvent(await memberEvents.next(), "machines_changed", machine.id);

  await ownerMachine.delete();
  machineCleanup.forget(machine.id);
  assertMachineEvent(await ownerEvents.next(), "machines_changed", machine.id);

  unsubscribeOwner();
  unsubscribeOwner = () => {};
  unsubscribeMember();
  unsubscribeMember = () => {};
  console.log("\n✅ SDK account event smoke tests passed.");
}

async function cleanup(): Promise<void> {
  unsubscribeOwner();
  unsubscribeMember();
  await machineCleanup.cleanup();
  if (originalUserAppData) {
    if (Object.hasOwn(originalUserAppData, USER_APP_DATA_KEY)) {
      await ownerClient.setUserAppData(
        USER_APP_DATA_KEY,
        originalUserAppData[USER_APP_DATA_KEY],
      );
    } else {
      await ownerClient.deleteUserAppData(USER_APP_DATA_KEY);
    }
  }
  if (originalProfile) await ownerClient.replaceProfile(originalProfile);
}

runSmokeTest(main, cleanup);
