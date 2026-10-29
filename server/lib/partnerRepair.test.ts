// Run with:  node --import tsx --test server/lib/partnerRepair.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRepairCouples, baselineFromOwnIncomes, assessCoupleBaseline } from "./partnerRepair.js";

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

// ── Household baseline repair ──────────────────────────────────────────────

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const inc = (euros: number, iso: string, category = "salary") => ({ amount: euros * 100, date: new Date(iso), category });

// "Now" is in 2026-10: October is the current, still-open period.
const NOW = "2026-10";

test("baseline = her income rows of her most recent CLOSED month with income", () => {
  const rows = [inc(900, "2026-08-28"), inc(925, "2026-09-28"), inc(50, "2026-09-10", "freelance")];
  assert.equal(baselineFromOwnIncomes(rows, monthOf, NOW), 97500);
});

test("the current period is never used: mid-month it is partial", () => {
  // Only the first of two October paydays is in so far.
  const rows = [inc(925, "2026-09-28"), inc(400, "2026-10-05")];
  assert.equal(baselineFromOwnIncomes(rows, monthOf, NOW), 92500);
  assert.equal(baselineFromOwnIncomes([inc(400, "2026-10-05")], monthOf, NOW), null);
});

test("transfers in are not earnings; no income rows → null (baseline left alone)", () => {
  assert.equal(baselineFromOwnIncomes([inc(3230, "2026-09-28"), inc(500, "2026-09-02", "transfer_in")], monthOf, NOW), 323000);
  assert.equal(baselineFromOwnIncomes([inc(500, "2026-09-02", "transfer_in")], monthOf, NOW), null);
  assert.equal(baselineFromOwnIncomes([], monthOf, NOW), null);
});

test("a closed period summing to 0 never becomes a 0 baseline", () => {
  assert.equal(baselineFromOwnIncomes([inc(0, "2026-09-28")], monthOf, NOW), null);
});

test("an owner baseline holding the household total (old income step) is flagged", () => {
  // Old code wrote 3230 + 925 into the owner's row; the partner also has her own 925.
  const check = assessCoupleBaseline({ ownerBaseline: 415500, partnerBaseline: 92500, ownerFromIncomes: 323000, partnerFromIncomes: 92500 });
  assert.equal(check.likelyDoubleCount, true);
  assert.equal(check.ownerEqualsCombinedIncomes, true);
  assert.equal(check.ownerAboveOwnIncomes, true);
  assert.equal(check.ownerWouldChange, true);
  assert.equal(check.partnerWouldChange, false);
});

test("per-person baselines already right are not flagged and nothing changes", () => {
  const check = assessCoupleBaseline({ ownerBaseline: 323000, partnerBaseline: 92500, ownerFromIncomes: 323000, partnerFromIncomes: 92500 });
  assert.deepEqual(check, {
    partnerHasBaseline: true, ownerAboveOwnIncomes: false, ownerEqualsCombinedIncomes: false,
    likelyDoubleCount: false, ownerWouldChange: false, partnerWouldChange: false,
  });
});

test("a partner without a baseline can't be double counted; no income rows → no change", () => {
  const check = assessCoupleBaseline({ ownerBaseline: 415500, partnerBaseline: 0, ownerFromIncomes: null, partnerFromIncomes: null });
  assert.equal(check.likelyDoubleCount, false);
  assert.equal(check.ownerAboveOwnIncomes, null);
  assert.equal(check.ownerWouldChange, false);
});

test("baselines are only rewritten for a couple whose baseline likely counts the partner twice", () => {
  // Owner's baseline below her own incomes (a raise): not a double count, so
  // nothing is written, even though the figures differ.
  const raise = assessCoupleBaseline({ ownerBaseline: 300000, partnerBaseline: 92500, ownerFromIncomes: 323000, partnerFromIncomes: 90000 });
  assert.equal(raise.likelyDoubleCount, false);
  assert.equal(raise.ownerWouldChange, false);
  assert.equal(raise.partnerWouldChange, false);
});

test("a double-counted couple without closed-period incomes keeps the stored baseline", () => {
  const check = assessCoupleBaseline({ ownerBaseline: 92500, partnerBaseline: 92500, ownerFromIncomes: null, partnerFromIncomes: 92500 });
  assert.equal(check.likelyDoubleCount, true);
  assert.equal(check.ownerWouldChange, false); // null: never set (and never to 0)
});
