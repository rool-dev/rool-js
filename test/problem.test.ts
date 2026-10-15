import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolProblem } from "../src/problem.js";

function problem(code: string): RoolProblem {
  return new RoolProblem({
    type: "about:blank",
    title: "t",
    status: 403,
    code,
    detail: "d",
  });
}

test("renamed codes read the same from the current and the future server", () => {
  assert.equal(problem("account_suspended").code, "user_suspended");
  assert.equal(problem("user_suspended").code, "user_suspended");
  assert.equal(problem("account_access_required").code, "plan_required");
  assert.equal(problem("plan_required").code, "plan_required");
  assert.equal(problem("machine_not_found").code, "machine_not_found");
});
