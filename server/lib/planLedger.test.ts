// Run with:  node --import tsx --test server/lib/planLedger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedByPlan, depositsKeepingLine, monthContribution, sumContributions, totalContributions } from "./planLedger.js";

test("with a deposit: the larger of deposit and booked, never both", () => {
  assert.equal(monthContribution(200, 200), 200);
  assert.equal(monthContribution(260, 200), 260);
  assert.equal(monthContribution(0, 150), 150);
  assert.equal(monthContribution(200, -50), 200);
});

test("without a deposit: what was booked, withdrawals included (may be negative)", () => {
  assert.equal(monthContribution(null, 150), 150);
  assert.equal(monthContribution(null, -80), -80);
  assert.equal(monthContribution(null, 0), 0);
});

test("booked per plan nets refunds; a line without a plan counts on its own", () => {
  const booked = bookedByPlan([
    { lifePlanId: "p1", allocationId: "l1", amount: 5000 },
    { lifePlanId: "p1", allocationId: "l1", kind: "refund", amount: 1000 },
    { lifePlanId: null, allocationId: "l9", amount: 700 },
  ]);
  assert.deepEqual([...booked], [["p1", 4000], ["line:l9", 700]]);
});

test("X sums each plan's contribution once and never floors a plan without a deposit", () => {
  const booked = new Map([["p1", 20000], ["line:l9", 700], ["p3", -3000]]);
  assert.equal(sumContributions([{ planId: "p1", amount: 20000 }, { planId: "p2", amount: 5000 }], booked), 20000 + 5000 + 700 - 3000);
  assert.equal(sumContributions([], new Map()), 0);
});

test("totals over every month: per plan and month the same rule, then summed", () => {
  const totals = totalContributions(
    [
      { planId: "p1", month: "2026-09", amount: 20000 }, // deposit above booked: the deposit
      { planId: "p1", month: "2026-10", amount: 5000 },  // deposit below booked: booked
      { planId: "p2", month: "2026-10", amount: 3000 },  // deposit only
    ],
    [
      { planId: "p1", month: "2026-09", amount: 15000 },
      { planId: "p1", month: "2026-10", amount: 9000 },
      { planId: "p1", month: "2026-10", kind: "refund", amount: 1000 },
      { planId: "p1", month: "2026-11", kind: "refund", amount: 4000 }, // no deposit: negative month
      { planId: "p3", month: "2026-11", amount: 700 },
    ],
  );
  assert.deepEqual(Object.fromEntries(totals), { p1: 20000 + 8000 - 4000, p2: 3000, p3: 700 });
  assert.equal(totalContributions([], []).size, 0);
});

test("totals: moving a booking out of a plan (line deleted or relinked) changes only the months without a larger deposit", () => {
  const deposits = [{ planId: "p1", month: "2026-10", amount: 10000 }];
  const before = totalContributions(deposits, [
    { planId: "p1", month: "2026-10", amount: 6000 },
    { planId: "p1", month: "2026-11", amount: 6000 },
  ]);
  const after = totalContributions(deposits, []);
  assert.equal(before.get("p1")! - after.get("p1")!, 6000); // October keeps its 100 € deposit
});

test("deleting a plan line: each month it would lower keeps its contribution as the deposit", () => {
  const deposits = [{ month: "2026-10", amount: 20000 }, { month: "2026-11", amount: 5000 }];
  const booked = [
    { month: "2026-09", onLine: true, amount: 30000 },                    // no deposit: frozen at 300 €
    { month: "2026-10", onLine: true, amount: 15000 },                    // deposit 200 € covers it: nothing to do
    { month: "2026-11", onLine: true, amount: 9000 },                     // deposit 50 € below booked: frozen at 90 + 10
    { month: "2026-11", onLine: false, amount: 1000 },
    { month: "2026-12", onLine: true, kind: "refund", amount: 4000 },     // a withdrawal: left to the rule
    { month: "2027-01", onLine: false, amount: 700 },                     // not on the line: untouched
  ];
  const keep = depositsKeepingLine(deposits, booked);
  assert.deepEqual(keep, [{ month: "2026-09", amount: 30000 }, { month: "2026-11", amount: 10000 }]);
  // With the line gone and those deposits, every month but the withdrawal one is unchanged.
  const merged = [...deposits.filter(d => !keep.some(k => k.month === d.month)), ...keep];
  const withLine = totalContributions(merged.map(d => ({ planId: "p", ...d })), booked.map(b => ({ planId: "p", ...b })));
  const without = totalContributions(merged.map(d => ({ planId: "p", ...d })), booked.filter(b => !b.onLine).map(b => ({ planId: "p", ...b })));
  assert.equal(without.get("p")! - withLine.get("p")!, 4000); // only the withdrawal stops counting
});
