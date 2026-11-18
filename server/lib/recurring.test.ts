// Run with:  node --import tsx --test server/lib/recurring.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRecurringFrom, nearlyEqual, type RecurringInput } from "./recurring.js";

const NOW = new Date(2026, 10, 18); // 18 Nov 2026
const day = (y: number, m0: number, d: number) => new Date(y, m0, d);
const charges = (merchant: string, rows: [Date, number][]): RecurringInput[] =>
  rows.map(([date, amount]) => ({ merchant, amount, date }));
const only = (items: RecurringInput[]) => {
  const found = detectRecurringFrom(items, { now: NOW });
  assert.equal(found.length, 1, JSON.stringify(found));
  return found[0];
};

test("monthly: the same price on the same day of three months", () => {
  const c = only(charges("netflix", [[day(2026, 7, 5), 1299], [day(2026, 8, 5), 1299], [day(2026, 9, 5), 1299]]));
  assert.equal(c.cadence, "monthly");
  assert.equal(c.avgAmount, 1299);
  assert.equal(c.previousAmount, null);
  assert.equal(c.isNew, false);
  assert.deepEqual(c.nextExpectedDate, day(2026, 10, 5));
});

test("monthly: two people in a household paying the same service on the same day", () => {
  const rows: [Date, number][] = [];
  for (const m of [7, 8, 9]) rows.push([day(2026, m, 5), 1000], [day(2026, m, 5), 1200]);
  const c = only(charges("netflix", rows));
  assert.equal(c.cadence, "monthly");
  assert.equal(c.previousAmount, null, "two prices side by side are not a rise");
});

test("weekly: four charges a week apart", () => {
  const c = only(charges("gimnasio", [[day(2026, 9, 1), 900], [day(2026, 9, 8), 900], [day(2026, 9, 15), 900], [day(2026, 9, 22), 900]]));
  assert.equal(c.cadence, "weekly");
  assert.deepEqual(c.nextExpectedDate, day(2026, 9, 29));
});

test("weekly needs four charges: three a week apart are not enough", () => {
  assert.deepEqual(detectRecurringFrom(charges("gimnasio", [[day(2026, 9, 1), 900], [day(2026, 9, 8), 900], [day(2026, 9, 15), 900]]), { now: NOW }), []);
});

test("yearly: two charges of the same price a year apart", () => {
  const c = only(charges("amazon prime", [[day(2024, 10, 2), 4990], [day(2025, 10, 2), 4990]]));
  assert.equal(c.cadence, "yearly");
  assert.deepEqual(c.nextExpectedDate, day(2026, 10, 2));
});

test("yearly: two different purchases a year apart are not a subscription", () => {
  assert.deepEqual(detectRecurringFrom(charges("ikea", [[day(2024, 10, 2), 15000], [day(2025, 10, 8), 13900]]), { now: NOW }), []);
});

test("a café bought many times a month is not a monthly commitment (adjacent fix)", () => {
  const rows: [Date, number][] = [];
  for (let m = 7; m <= 10; m++) for (let d = 1; d <= 20; d += 2) rows.push([day(2026, m, d), 320]);
  assert.deepEqual(detectRecurringFrom(charges("cafe lopez", rows), { now: NOW }), []);
});

test("price rise: the latest charge is higher than a stable price before it", () => {
  const c = only(charges("netflix", [[day(2026, 6, 5), 1299], [day(2026, 7, 5), 1299], [day(2026, 8, 5), 1299], [day(2026, 9, 5), 1599]]));
  assert.equal(c.previousAmount, 1299);
  assert.equal(c.lastAmount, 1599);
});

test("no price rise once the new price repeats, nor when the amount just wobbles", () => {
  const settled = only(charges("netflix", [[day(2026, 6, 5), 1299], [day(2026, 7, 5), 1299], [day(2026, 8, 5), 1599], [day(2026, 9, 5), 1599]]));
  assert.equal(settled.previousAmount, null);
  const wobbly = only(charges("movistar", [[day(2026, 6, 5), 4100], [day(2026, 7, 5), 3900], [day(2026, 8, 5), 4000], [day(2026, 9, 5), 4200]]));
  assert.equal(wobbly.previousAmount, null);
});

test("new: a first charge that repeats a month later, recently (a trial turned paid)", () => {
  const c = only(charges("disney plus", [[day(2026, 9, 10), 899], [day(2026, 10, 10), 899]]));
  assert.equal(c.cadence, "monthly");
  assert.equal(c.isNew, true);
});

test("not new: two charges long ago, or two different amounts", () => {
  assert.deepEqual(detectRecurringFrom(charges("disney plus", [[day(2026, 2, 10), 899], [day(2026, 3, 10), 899]]), { now: NOW }), []);
  assert.deepEqual(detectRecurringFrom(charges("mercadona", [[day(2026, 9, 10), 4510], [day(2026, 10, 10), 4780]]), { now: NOW }), []);
});

test("nearlyEqual: within 0.50 or 1 %", () => {
  assert.ok(nearlyEqual(899, 949));
  assert.ok(!nearlyEqual(899, 950));
  assert.ok(nearlyEqual(100000, 100900));
});
