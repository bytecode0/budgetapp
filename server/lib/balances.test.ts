import { test } from "node:test";
import assert from "node:assert/strict";
import { settleUp, type MemberBalance } from "./balances.js";

const b = (userId: string, balance: number): MemberBalance => ({ userId, balance, paid: 0, owed: 0 });

test("two members: debtor pays creditor the full gap", () => {
  const s = settleUp([b("luis", 140), b("ana", -140)]);
  assert.deepEqual(s, [{ fromUserId: "ana", toUserId: "luis", amount: 140 }]);
});

test("settled up (all zero) → no settlements", () => {
  assert.deepEqual(settleUp([b("a", 0), b("b", 0)]), []);
});

test("three members: greedy match largest debtor to largest creditor", () => {
  const s = settleUp([b("a", 100), b("b", 50), b("c", -150)]);
  // c owes 150 → pays a 100 then b 50
  assert.deepEqual(s, [
    { fromUserId: "c", toUserId: "a", amount: 100 },
    { fromUserId: "c", toUserId: "b", amount: 50 },
  ]);
  // total settled equals total owed
  assert.equal(s.reduce((t, x) => t + x.amount, 0), 150);
});
