import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoffFor } from "./backfillLegacyOwners.js";

test("no partner: every row is the owner's", () => {
  assert.deepEqual(cutoffFor([]), { hasPartner: false, cutoff: null });
});

test("a partner: rows before the earliest join are the owner's", () => {
  const a = new Date("2026-10-01T00:00:00Z");
  const b = new Date("2026-09-01T00:00:00Z");
  assert.deepEqual(cutoffFor([a, b]), { hasPartner: true, cutoff: b });
});

test("a partner without a membership row: nothing is filled", () => {
  const { cutoff } = cutoffFor([new Date("2026-10-01T00:00:00Z"), null]);
  assert.equal(cutoff?.getTime(), 0);
});
