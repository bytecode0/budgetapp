// Run with:  node --import tsx --test server/lib/householdIncome.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBaselines } from "./householdIncome.js";
import { toCents } from "./money.js";

const OWNER = "owner";
const PARTNER = "partner";
const couple = () => [
  { userId: OWNER, monthlyIncome: toCents(3230) },
  { userId: PARTNER, monthlyIncome: toCents(925) },
];

/** What PATCH /api/allocations/settings/income does: write the caller's row. */
function save(rows: { userId: string; monthlyIncome: number }[], authUserId: string, cents: number) {
  return rows.map(r => (r.userId === authUserId ? { ...r, monthlyIncome: cents } : r));
}

test("couple 3230 € + 925 € = 4155 €; each sees their own figure to edit", () => {
  assert.deepEqual(splitBaselines(couple(), OWNER), { monthlyIncome: toCents(4155), ownMonthlyIncome: toCents(3230), isCouple: true });
  assert.deepEqual(splitBaselines(couple(), PARTNER), { monthlyIncome: toCents(4155), ownMonthlyIncome: toCents(925), isCouple: true });
});

test("saving the editor without a change is idempotent (it holds the own figure, not the sum)", () => {
  for (const who of [OWNER, PARTNER]) {
    let rows = couple();
    for (let i = 0; i < 3; i++) {
      const { ownMonthlyIncome } = splitBaselines(rows, who); // what the editor is pre-filled with
      rows = save(rows, who, ownMonthlyIncome);
    }
    assert.equal(splitBaselines(rows, who).monthlyIncome, toCents(4155));
  }
});

test("a single user: own figure is the household's; nobody configured is 0", () => {
  assert.deepEqual(splitBaselines([{ userId: OWNER, monthlyIncome: 323000 }], OWNER), { monthlyIncome: 323000, ownMonthlyIncome: 323000, isCouple: false });
  assert.deepEqual(splitBaselines([], OWNER), { monthlyIncome: 0, ownMonthlyIncome: 0, isCouple: false });
});
