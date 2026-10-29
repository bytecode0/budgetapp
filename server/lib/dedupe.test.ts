// Run with:  node --import tsx --test server/lib/dedupe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGroups } from "./dedupe.js";

test("same amount within 2 days groups; an expense and its refund never do", () => {
  const groups = findDuplicateGroups([
    { id: "a", amount: 2000, date: "2026-10-01", kind: "expense" },
    { id: "b", amount: 2000, date: "2026-10-02", kind: "expense" },
    { id: "r", amount: 2000, date: "2026-10-02", kind: "refund" },
    { id: "c", amount: 2000, date: "2026-10-01" }, // legacy row: an expense
  ]);
  assert.deepEqual(groups.map(g => g.map(x => x.id).sort()), [["a", "b", "c"]]);
});
