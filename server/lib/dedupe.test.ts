// Run with:  node --import tsx --test server/lib/dedupe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canPair, dismissalPairs, findDuplicateGroups, mergeTargets, pairKey, pairsOf } from "./dedupe.js";

const ids = (groups: { id: string }[][]) => groups.map(g => g.map(x => x.id).sort());

test("same amount within 2 days groups; an expense and its refund never do", () => {
  const groups = findDuplicateGroups([
    { id: "a", amount: 2000, date: "2026-10-01", kind: "expense" },
    { id: "b", amount: 2000, date: "2026-10-02", kind: "expense" },
    { id: "r", amount: 2000, date: "2026-10-02", kind: "refund" },
    { id: "c", amount: 2000, date: "2026-10-01" }, // legacy row: an expense
  ]);
  assert.deepEqual(ids(groups), [["a", "b", "c"]]);
});

test("items chain within the window; a gap over 2 days splits", () => {
  const groups = findDuplicateGroups([
    { id: "a", amount: 500, date: "2026-10-01" },
    { id: "b", amount: 500, date: "2026-10-03" },
    { id: "c", amount: 500, date: "2026-10-05" }, // 4 days from a, chained via b
    { id: "d", amount: 500, date: "2026-10-10" },
  ]);
  assert.deepEqual(ids(groups), [["a", "b", "c"]]);
});

test("canPair: same account, same pipeline, different externalIds → distinct bank movements", () => {
  const base = { amount: 350, date: "2026-10-01", accountId: "acc1" };
  assert.equal(canPair({ ...base, id: "a", source: "import", externalId: "x1" }, { ...base, id: "b", source: "import", externalId: "x2" }), false);
  assert.equal(canPair({ ...base, id: "a", source: "bank_sync", externalId: "x1" }, { ...base, id: "b", source: "bank_sync", externalId: "x2" }), false);
});

test("canPair: manual, mixed sources or different accounts still pair", () => {
  const base = { amount: 350, date: "2026-10-01" };
  // one manual
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "manual", externalId: null }, { ...base, id: "b", accountId: "acc1", source: "import", externalId: "x2" }), true);
  // both manual
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "manual" }, { ...base, id: "b", accountId: "acc1", source: "manual" }), true);
  // file import vs bank sync of the same account: the real duplicate case
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "import", externalId: "x1" }, { ...base, id: "b", accountId: "acc1", source: "bank_sync", externalId: "x2" }), true);
  // different accounts
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "import", externalId: "x1" }, { ...base, id: "b", accountId: "acc2", source: "import", externalId: "x2" }), true);
  // no account on either: not "the same account"
  assert.equal(canPair({ ...base, id: "a", accountId: null, source: "import", externalId: "x1" }, { ...base, id: "b", accountId: null, source: "import", externalId: "x2" }), true);
});

test("two coffees on the same imported account are not a group; a manual copy of one is", () => {
  const row = { amount: 250, accountId: "acc1", source: "import" };
  const groups = findDuplicateGroups([
    { ...row, id: "c1", date: "2026-10-01", externalId: "h1" },
    { ...row, id: "c2", date: "2026-10-01", externalId: "h2" },
  ]);
  assert.deepEqual(groups, []);

  const withManual = findDuplicateGroups([
    { ...row, id: "c1", date: "2026-10-01", externalId: "h1" },
    { ...row, id: "c2", date: "2026-10-01", externalId: "h2" },
    { id: "m", amount: 250, accountId: "acc1", source: "manual", externalId: null, date: "2026-10-02" },
  ]);
  // c1–m and c2–m link; c1–c2 don't, but all three are connected through m.
  assert.deepEqual(ids(withManual), [["c1", "c2", "m"]]);
});

test("a dismissed pair never links again; a dismissed group disappears", () => {
  const items = [
    { id: "a", amount: 1000, date: "2026-10-01" },
    { id: "b", amount: 1000, date: "2026-10-01" },
    { id: "c", amount: 1000, date: "2026-10-02" },
  ];
  const all = new Set(pairsOf(["a", "b", "c"]).map(([x, y]) => pairKey(x, y)));
  assert.deepEqual(findDuplicateGroups(items, all), []);

  // Only a–b dismissed: c still links both, so the three remain a group.
  assert.deepEqual(ids(findDuplicateGroups(items, new Set([pairKey("b", "a")]))), [["a", "b", "c"]]);
  // Two items, their pair dismissed: no group.
  assert.deepEqual(findDuplicateGroups(items.slice(0, 2), new Set([pairKey("a", "b")])), []);
});

test("a new expense matching a dismissed one forms a new group with it", () => {
  const dismissed = new Set([pairKey("a", "b")]);
  const groups = findDuplicateGroups([
    { id: "a", amount: 1000, date: "2026-10-01" },
    { id: "b", amount: 1000, date: "2026-10-05" }, // far from the new one
    { id: "n", amount: 1000, date: "2026-10-02" }, // new, 1 day from a, 3 from b
  ], dismissed);
  assert.deepEqual(ids(groups), [["a", "n"]]);
});

test("pairKey is order-independent and pairsOf lists every pair once", () => {
  assert.equal(pairKey("b", "a"), pairKey("a", "b"));
  assert.deepEqual(pairsOf(["c", "a", "b", "a"]), [["a", "b"], ["a", "c"], ["b", "c"]]);
});

test("mergeTargets only deletes expenses the caller may delete", () => {
  const deletable = new Set(["k", "r1", "r2"]);
  assert.deepEqual(mergeTargets("k", ["r1", "r2", "r1"], deletable), { keepId: "k", removeIds: ["r1", "r2"] });
  // A partner's private row (not visible) → 404, nothing deleted.
  assert.deepEqual(mergeTargets("k", ["r1", "hers"], deletable), { error: "Expense not found", status: 404 });
  assert.deepEqual(mergeTargets("hers", ["r1"], deletable), { error: "Expense to keep not found", status: 404 });
  assert.equal((mergeTargets("k", ["k"], deletable) as { status: number }).status, 400);
  assert.equal((mergeTargets("k", [], deletable) as { status: number }).status, 400);
  assert.equal((mergeTargets(undefined, ["r1"], deletable) as { status: number }).status, 400);
  assert.equal((mergeTargets("k", [42], deletable) as { status: number }).status, 400);
});

test("dismissalPairs: 2+ visible ids → every pair; anything else is rejected", () => {
  const visible = new Set(["a", "b", "c"]);
  assert.deepEqual(dismissalPairs(["c", "a", "b"], visible), { pairs: [["a", "b"], ["a", "c"], ["b", "c"]] });
  assert.equal((dismissalPairs(["a", "a"], visible) as { status: number }).status, 400);
  assert.equal((dismissalPairs("a", visible) as { status: number }).status, 400);
  assert.equal((dismissalPairs(["a", "hidden"], visible) as { status: number }).status, 404);
  const many = Array.from({ length: 51 }, (_, i) => `x${i}`);
  assert.equal((dismissalPairs(many, new Set(many)) as { status: number }).status, 400);
});
