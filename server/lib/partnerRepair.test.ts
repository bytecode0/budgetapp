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

test("baseline = her income rows of her most recent month with income", () => {
  const rows = [inc(900, "2026-08-28"), inc(925, "2026-09-28"), inc(50, "2026-09-10", "freelance")];
  assert.equal(baselineFromOwnIncomes(rows, monthOf), 97500);
});

test("transfers in are not earnings; no income rows → null (baseline left alone)", () => {
  assert.equal(baselineFromOwnIncomes([inc(3230, "2026-09-28"), inc(500, "2026-10-02", "transfer_in")], monthOf), 323000);
  assert.equal(baselineFromOwnIncomes([inc(500, "2026-10-02", "transfer_in")], monthOf), null);
  assert.equal(baselineFromOwnIncomes([], monthOf), null);
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
