// Run with:  npx tsx --test server/lib/period.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodKeyFor, periodBounds, currentPeriodKey, periodKeyOffset, enumeratePeriods, clampCycleStartDay,
} from "./period.js";

test("cycleStartDay=1 reduces exactly to calendar-month behavior", () => {
  assert.equal(periodKeyFor(new Date(2026, 7, 1), 1), "2026-08");  // Aug 1
  assert.equal(periodKeyFor(new Date(2026, 7, 31), 1), "2026-08"); // Aug 31
  assert.equal(periodKeyFor(new Date(2026, 0, 1), 1), "2026-01");  // Jan 1

  const { start, end } = periodBounds("2026-08", 1);
  assert.deepEqual(start, new Date(2026, 7, 1));
  assert.deepEqual(end, new Date(2026, 8, 1));
});

test("cycleStartDay=25: Jul 25-31 belongs to the August period (the confirmed example)", () => {
  assert.equal(periodKeyFor(new Date(2026, 6, 25), 25), "2026-08"); // payday itself
  assert.equal(periodKeyFor(new Date(2026, 6, 28), 25), "2026-08");
  assert.equal(periodKeyFor(new Date(2026, 6, 31), 25), "2026-08");
});

test("cycleStartDay=25: early-month days still belong to the prior period", () => {
  assert.equal(periodKeyFor(new Date(2026, 6, 10), 25), "2026-07"); // Jul 10 -> July cycle (Jun25-Jul24)
  assert.equal(periodKeyFor(new Date(2026, 6, 24), 25), "2026-07"); // last day before payday
});

test("cycleStartDay=25: period bounds match the example exactly", () => {
  const { start, end } = periodBounds("2026-08", 25);
  assert.deepEqual(start, new Date(2026, 6, 25)); // Jul 25
  assert.deepEqual(end, new Date(2026, 7, 25));   // Aug 25 (exclusive)
});

test("periodKeyFor and periodBounds round-trip for a range of cycleStartDay values", () => {
  for (const day of [1, 2, 5, 15, 24, 25, 28]) {
    const { start, end } = periodBounds("2026-08", day);
    // every day in [start, end) must map back to "2026-08"
    for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) {
      assert.equal(periodKeyFor(new Date(t), day), "2026-08", `day=${day} t=${new Date(t)}`);
    }
    // the day just before start belongs to the prior period; the day at end belongs to the next
    const beforeStart = new Date(start.getTime() - 86_400_000);
    assert.notEqual(periodKeyFor(beforeStart, day), "2026-08");
    assert.notEqual(periodKeyFor(end, day), "2026-08");
  }
});

test("year boundary: December -> January period under a late-month payday", () => {
  assert.equal(periodKeyFor(new Date(2026, 11, 28), 25), "2027-01"); // Dec 28 -> January cycle
  const { start, end } = periodBounds("2027-01", 25);
  assert.deepEqual(start, new Date(2026, 11, 25));
  assert.deepEqual(end, new Date(2027, 0, 25));
});

test("clampCycleStartDay keeps the value within [1, 28]", () => {
  assert.equal(clampCycleStartDay(0), 1);
  assert.equal(clampCycleStartDay(-5), 1);
  assert.equal(clampCycleStartDay(29), 28);
  assert.equal(clampCycleStartDay(31), 28);
  assert.equal(clampCycleStartDay(15), 15);
  assert.equal(clampCycleStartDay(NaN), 1);
});

test("currentPeriodKey delegates to periodKeyFor for 'now'", () => {
  assert.equal(currentPeriodKey(1, new Date(2026, 5, 15)), "2026-06");
  assert.equal(currentPeriodKey(25, new Date(2026, 5, 28)), "2026-07");
});

test("periodKeyOffset walks whole periods regardless of cycleStartDay (labels are always sequential months)", () => {
  assert.equal(periodKeyOffset("2026-08", 1), "2026-09");
  assert.equal(periodKeyOffset("2026-08", -1), "2026-07");
  assert.equal(periodKeyOffset("2026-12", 1), "2027-01");
  assert.equal(periodKeyOffset("2026-01", -1), "2025-12");
});

test("enumeratePeriods lists every label inclusive, across a year boundary", () => {
  assert.deepEqual(enumeratePeriods("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(enumeratePeriods("2026-08", "2026-08"), ["2026-08"]);
});
