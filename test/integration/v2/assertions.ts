import assert from "node:assert/strict";
import {
  RoolFileError,
  RoolProblem,
  type MachineSummary,
} from "../../../src/index.js";

export function assertIsoDate(value: string, field?: string): void {
  assert.equal(
    new Date(value).toISOString(),
    value,
    field ? `${field} should be ISO 8601` : undefined,
  );
}

export function assertMachineSummary(machine: MachineSummary): void {
  assert.equal(typeof machine.id, "string");
  assert.equal(typeof machine.name, "string");
  assert.equal(typeof machine.hostname, "string");
  assert.equal(typeof machine.inboundEmailAddress, "string");
  assert(machine.inboundEmailAddress.startsWith(`${machine.hostname}@`));
  assert.equal(typeof machine.nextInboundEmailAddress, "string");
  assert(machine.nextInboundEmailAddress?.startsWith(`${machine.hostname}@`));
  assert.deepEqual(machine.meta, {});
  assert(["owner", "admin", "editor", "viewer"].includes(machine.role));
  assert.equal(typeof machine.ownerId, "string");
  assert.equal(typeof machine.size, "number");
  assertIsoDate(machine.createdAt, "machine.createdAt");
  assertIsoDate(machine.updatedAt, "machine.updatedAt");
  assert.equal(typeof machine.memberCount, "number");
  assert(["active", "locked"].includes(machine.state));
}

export async function expectProblem(
  action: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof RoolProblem);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.type, `https://docs.rool.dev/sdk/#problem-${code}`);
    return;
  }
  assert.fail(`expected ${code}`);
}

export async function expectFileError(
  action: () => Promise<unknown>,
  status: number,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof RoolFileError);
    assert.equal(error.status, status);
    return;
  }
  assert.fail(`expected machine file HTTP ${status}`);
}
