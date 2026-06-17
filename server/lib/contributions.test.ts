import { test } from "node:test";
import assert from "node:assert/strict";
import { computeShares, splitByWeights, incomeWeights, equalWeights } from "./contributions.js";

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

test("proportional split by income: 3000/2000 → 60/40 of 20000c", () => {
  const shares = computeShares({
    amountCents: 20000,
    basis: "income",
    memberIds: ["luis", "ana"],
    payerUserId: "luis",
    incomeByUser: { luis: 300000, ana: 200000 },
  });
  assert.equal(shares.get("luis"), 12000);
  assert.equal(shares.get("ana"), 8000);
  assert.equal(sum(shares), 20000);
});

test("equal split of an odd amount: residue goes to the payer", () => {
  const shares = computeShares({
    amountCents: 10001,
    basis: "equal",
    memberIds: ["luis", "ana"],
    payerUserId: "ana",
  });
  // 10001 / 2 = 5000 each, +1c residue to payer (ana)
  assert.equal(shares.get("ana"), 5001);
  assert.equal(shares.get("luis"), 5000);
  assert.equal(sum(shares), 10001);
});

test("Σ shares always equals the amount (3-way, non-divisible)", () => {
  const shares = computeShares({
    amountCents: 10000,
    basis: "equal",
    memberIds: ["a", "b", "c"],
    payerUserId: "b",
  });
  assert.equal(sum(shares), 10000);
  // 3333 each, residue +1 to payer b
  assert.equal(shares.get("b"), 3334);
});

test("income weights fall back to equal when nobody has income", () => {
  const w = incomeWeights(["a", "b"], {});
  assert.deepEqual([...w.values()], [...equalWeights(["a", "b"]).values()]);
});

test("custom split by basis points", () => {
  const shares = computeShares({
    amountCents: 10000,
    basis: "custom",
    memberIds: ["a", "b"],
    payerUserId: "a",
    customSharePctByUser: { a: 7000, b: 3000 },
  });
  assert.equal(shares.get("a"), 7000);
  assert.equal(shares.get("b"), 3000);
  assert.equal(sum(shares), 10000);
});

test("payer absent from members is still included and gets the residue", () => {
  const shares = splitByWeights(100, new Map([["a", 1], ["b", 1]]), "a");
  assert.equal(sum(shares), 100);
  assert.equal(shares.get("a"), 50);
  assert.equal(shares.get("b"), 50);
});
