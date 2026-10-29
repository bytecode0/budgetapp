// Run with:  node --import tsx --test server/lib/partnerRepair.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRepairCouples } from "./partnerRepair.js";

test("a one-level couple is repaired", () => {
  assert.deepEqual(planRepairCouples([{ userId: "b", linkedUserId: "a" }]), [{ memberId: "b", poolId: "a", skip: null }]);
});

test("chains are skipped on both ends: a member someone links to, and a pool that is itself linked", () => {
  // c → b → a
  const plan = planRepairCouples([
    { userId: "b", linkedUserId: "a" },
    { userId: "c", linkedUserId: "b" },
  ]);
  assert.deepEqual(plan, [
    { memberId: "b", poolId: "a", skip: "member_has_partner_linked" },
    { memberId: "c", poolId: "b", skip: "pool_is_linked" },
  ]);
});

test("a cycle is skipped entirely", () => {
  const plan = planRepairCouples([{ userId: "a", linkedUserId: "b" }, { userId: "b", linkedUserId: "a" }]);
  assert.ok(plan.every(c => c.skip !== null));
});

test("two independent couples don't affect each other", () => {
  const plan = planRepairCouples([{ userId: "b", linkedUserId: "a" }, { userId: "d", linkedUserId: "c" }]);
  assert.ok(plan.every(c => c.skip === null));
});
