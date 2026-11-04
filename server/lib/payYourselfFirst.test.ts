// Run with:  node --import tsx --test server/lib/payYourselfFirst.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shareApplies } from "./payYourselfFirst.js";

test("a share judges a month only if chosen before it ended", () => {
  const end = new Date("2026-11-01T00:00:00Z");
  assert.equal(shareApplies(null, end), true);
  assert.equal(shareApplies(new Date("2026-10-15T00:00:00Z"), end), true);
  assert.equal(shareApplies(new Date("2026-11-03T00:00:00Z"), end), false);
});
