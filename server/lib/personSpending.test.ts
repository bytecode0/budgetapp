// Run with:  node --import tsx --test server/lib/personSpending.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spentByPerson, type PersonExpense } from "./personSpending.js";

const e = (id: string, amount: number, extra: Partial<PersonExpense> = {}): PersonExpense =>
  ({ id, amount, scope: "personal", payerUserId: "ana", beneficiaryUserId: null, shares: [], ...extra });

test("MONEY: per-person spending adds up to the total, refunds included (negative)", () => {
  const expenses = [
    e("shop", 10000, { scope: "shared", shares: [{ userId: "ana", amount: 5000 }, { userId: "ben", amount: 5000 }] }),
    e("ben-lunch", 1500, { payerUserId: "ben" }),
    e("refund", 2000, { payerUserId: "ana" }),
    e("card-pay", 30000, { payerUserId: "ben" }),
  ];
  // As countedAmounts says: the refund counts negative, the card payment only
  // its pre-existing-debt part.
  const counted = new Map([["refund", -2000], ["card-pay", 12000]]);
  const by = spentByPerson(expenses, ["ana", "ben"], counted);
  assert.deepEqual(by, { ana: 5000 - 2000, ben: 5000 + 1500 + 12000 });
  const total = expenses.reduce((s, x) => s + (counted.get(x.id) ?? x.amount), 0);
  assert.equal(by.ana + by.ben, total);
});
