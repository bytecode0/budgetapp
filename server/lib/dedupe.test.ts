// Run with:  node --import tsx --test server/lib/dedupe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canPair, checkMerge, dismissalPairs, findDuplicateGroups, pairKey, pairsOf, parseDismiss, parseMerge,
} from "./dedupe.js";

const ids = (groups: { id: string }[][]) => groups.map(g => g.map(x => x.id).sort());
const status = (r: object) => (r as { status?: number }).status;

test("same amount within 2 days groups; an expense and its refund never do", () => {
  const groups = findDuplicateGroups([
    { id: "a", amount: 2000, date: "2026-10-01", kind: "expense" },
    { id: "b", amount: 2000, date: "2026-10-02", kind: "expense" },
    { id: "r", amount: 2000, date: "2026-10-02", kind: "refund" },
    { id: "c", amount: 2000, date: "2026-10-01" }, // legacy row: an expense
  ]);
  assert.deepEqual(ids(groups), [["a", "b", "c"]]);
});

test("a group never chains: every member is within 2 days of every other", () => {
  const groups = findDuplicateGroups([
    { id: "a", amount: 500, date: "2026-10-01" },
    { id: "b", amount: 500, date: "2026-10-03" },
    { id: "c", amount: 500, date: "2026-10-05" }, // 2 days from b, 4 from a
    { id: "d", amount: 500, date: "2026-10-10" },
  ]);
  // a joins nothing → [a]; b fits [a]; c doesn't fit [a, b] (4 days from a) → [c].
  assert.deepEqual(ids(groups), [["a", "b"]]);
});

test("canPair: two bank-sync rows of one account with different provider ids are distinct", () => {
  const base = { amount: 350, date: "2026-10-01", accountId: "acc1" };
  assert.equal(canPair({ ...base, id: "a", source: "bank_sync", externalId: "x1" }, { ...base, id: "b", source: "bank_sync", externalId: "x2" }), false);
});

test("canPair: file imports, manual, mixed sources or different accounts still pair", () => {
  const base = { amount: 350, date: "2026-10-01" };
  // two file imports of the same account: hashes differ across export formats
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "import", externalId: "h1" }, { ...base, id: "b", accountId: "acc1", source: "import", externalId: "h2" }), true);
  // one manual
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "manual", externalId: null }, { ...base, id: "b", accountId: "acc1", source: "bank_sync", externalId: "x2" }), true);
  // file import vs bank sync of the same account: the real duplicate case
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "import", externalId: "h1" }, { ...base, id: "b", accountId: "acc1", source: "bank_sync", externalId: "x2" }), true);
  // different accounts
  assert.equal(canPair({ ...base, id: "a", accountId: "acc1", source: "bank_sync", externalId: "x1" }, { ...base, id: "b", accountId: "acc2", source: "bank_sync", externalId: "x2" }), true);
  // no account on either: not "the same account"
  assert.equal(canPair({ ...base, id: "a", accountId: null, source: "bank_sync", externalId: "x1" }, { ...base, id: "b", accountId: null, source: "bank_sync", externalId: "x2" }), true);
});

test("the same movement re-imported from another export format is a group", () => {
  const row = { amount: 4200, accountId: "acc1", source: "import", date: "2026-10-01" };
  const groups = findDuplicateGroups([{ ...row, id: "csv", externalId: "h-csv" }, { ...row, id: "xlsx", externalId: "h-xlsx" }]);
  assert.deepEqual(ids(groups), [["csv", "xlsx"]]);
});

test("a manual coffee never glues two bank-sync coffees into one group", () => {
  const row = { amount: 250, accountId: "acc1", source: "bank_sync", date: "2026-10-01" };
  const groups = findDuplicateGroups([
    { ...row, id: "e1", externalId: "p1" },
    { ...row, id: "e2", externalId: "p2" },
    { id: "m", amount: 250, accountId: "acc1", source: "manual", externalId: null, date: "2026-10-02" },
  ]);
  // e1 → [e1]; e2 can't join it → [e2]; m joins the first that fits: [e1, m].
  assert.deepEqual(ids(groups), [["e1", "m"]]);
  // Every pair in every group can pair, so any merge only deletes a true candidate.
  for (const g of groups) for (const [x, y] of pairsOf(g.map(e => e.id))) {
    assert.ok(canPair(g.find(e => e.id === x)!, g.find(e => e.id === y)!));
  }
});

test("a dismissed pair never ends up in one group again, even through a new expense", () => {
  const items = [
    { id: "x", amount: 1000, date: "2026-10-01" },
    { id: "y", amount: 1000, date: "2026-10-02" },
  ];
  const dismissed = new Set([pairKey("y", "x")]);
  assert.deepEqual(findDuplicateGroups(items, dismissed), []);

  // A new n within 2 days of both: it pairs with one of them, never both.
  const groups = findDuplicateGroups([...items, { id: "n", amount: 1000, date: "2026-10-02" }], dismissed);
  assert.deepEqual(ids(groups), [["n", "x"]]);
  for (const g of groups) assert.ok(!(g.some(e => e.id === "x") && g.some(e => e.id === "y")));

  // Dismissing a whole group of three removes it.
  const three = [...items, { id: "z", amount: 1000, date: "2026-10-02" }];
  const all = new Set(pairsOf(["x", "y", "z"]).map(([a, b]) => pairKey(a, b)));
  assert.deepEqual(findDuplicateGroups(three, all), []);
});

test("a new expense matching a dismissed one forms a new group with it", () => {
  const groups = findDuplicateGroups([
    { id: "a", amount: 1000, date: "2026-10-01" },
    { id: "b", amount: 1000, date: "2026-10-05" },
    { id: "n", amount: 1000, date: "2026-10-02" },
  ], new Set([pairKey("a", "b")]));
  assert.deepEqual(ids(groups), [["a", "n"]]);
});

test("pairKey is order-independent and pairsOf lists every pair once", () => {
  assert.equal(pairKey("b", "a"), pairKey("a", "b"));
  assert.deepEqual(pairsOf(["c", "a", "b", "a"]), [["a", "b"], ["a", "c"], ["b", "c"]]);
});

test("parseMerge checks the shape and the cap before any query", () => {
  assert.deepEqual(parseMerge("k", ["r1", "r2", "r1"]), { keepId: "k", removeIds: ["r1", "r2"] });
  assert.equal(status(parseMerge("k", ["k"])), 400);
  assert.equal(status(parseMerge("k", [])), 400);
  assert.equal(status(parseMerge(undefined, ["r1"])), 400);
  assert.equal(status(parseMerge("k", [42])), 400);
  assert.equal(status(parseMerge("k", "r1")), 400);
  assert.equal(status(parseMerge("k", Array.from({ length: 51 }, (_, i) => `r${i}`))), 400);
  assert.ok(!("error" in parseMerge("k", Array.from({ length: 50 }, (_, i) => `r${i}`))));
});

test("checkMerge only deletes visible rows that are candidates of the kept one", () => {
  const row = { amount: 250, accountId: "acc1", date: "2026-10-01" };
  const k = { ...row, id: "k", source: "manual" };
  const r1 = { ...row, id: "r1", source: "bank_sync", externalId: "p1" };
  const r2 = { ...row, id: "r2", source: "bank_sync", externalId: "p2" };
  const far = { ...row, id: "far", source: "manual", date: "2026-10-09" };
  assert.deepEqual(checkMerge({ keepId: "k", removeIds: ["r1"] }, [k, r1]), { toRemove: [r1] });
  // A partner's hidden row (not loaded) → 404, nothing deleted.
  assert.equal(status(checkMerge({ keepId: "k", removeIds: ["r1", "hers"] }, [k, r1])), 404);
  assert.equal(status(checkMerge({ keepId: "hers", removeIds: ["r1"] }, [k, r1])), 404);
  // Keeping a bank row and deleting another bank row of the same account → refused.
  assert.equal(status(checkMerge({ keepId: "r1", removeIds: ["r2"] }, [r1, r2])), 400);
  // Not a candidate (8 days apart) → refused.
  assert.equal(status(checkMerge({ keepId: "k", removeIds: ["far"] }, [k, far])), 400);
});

test("parseDismiss + dismissalPairs: 2+ visible ids → every pair; anything else is rejected", () => {
  assert.deepEqual(parseDismiss(["c", "a", "b", "a"]), { ids: ["c", "a", "b"] });
  assert.equal(status(parseDismiss(["a", "a"])), 400);
  assert.equal(status(parseDismiss("a")), 400);
  assert.equal(status(parseDismiss(["a", 1])), 400);
  assert.equal(status(parseDismiss(Array.from({ length: 51 }, (_, i) => `x${i}`))), 400);
  const visible = new Set(["a", "b", "c"]);
  assert.deepEqual(dismissalPairs(["c", "a", "b"], visible), { pairs: [["a", "b"], ["a", "c"], ["b", "c"]] });
  assert.equal(status(dismissalPairs(["a", "hidden"], visible)), 404);
});
