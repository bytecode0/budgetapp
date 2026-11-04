import { test } from "node:test";
import assert from "node:assert/strict";
import { computeActiveStats, formatActiveStats, weekStart, type ActivityInput } from "./activeStats.js";

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

function input(over: Partial<ActivityInput> = {}): ActivityInput {
  return { users: [], activity: [], planOwners: [], deposits: [], householdSizes: [], ...over };
}

test("weekStart is the Monday (UTC) of the week", () => {
  assert.equal(weekStart(new Date("2026-11-04T23:30:00Z")), "2026-11-02"); // Wednesday
  assert.equal(weekStart(new Date("2026-11-02T00:00:00Z")), "2026-11-02"); // Monday
  assert.equal(weekStart(new Date("2026-11-08T22:00:00Z")), "2026-11-02"); // Sunday
});

test("active in 7 and 30 days counts each person once, whatever they did", () => {
  const s = computeActiveStats(input({
    users: [
      { id: "a", createdAt: daysAgo(60) },
      { id: "b", createdAt: daysAgo(20) },
      { id: "c", createdAt: daysAgo(3) },
    ],
    activity: [
      { userId: "a", at: daysAgo(2) },
      { userId: "a", at: daysAgo(10) },
      { userId: "b", at: daysAgo(15) },
      { userId: "c", at: daysAgo(40) }, // too old
    ],
  }), now);
  assert.deepEqual(s.active, { last7: 1, last30: 2 });
  assert.deepEqual(s.registered, { total: 3, last7: 1, last30: 2 });
});

test("activity of an unknown user (deleted, or not a user row) is ignored", () => {
  const s = computeActiveStats(input({
    users: [{ id: "a", createdAt: daysAgo(5) }],
    activity: [{ userId: "ghost", at: daysAgo(1) }],
    planOwners: ["ghost"],
    deposits: [{ userId: "ghost", at: daysAgo(1) }],
  }), now);
  assert.deepEqual(s.active, { last7: 0, last30: 0 });
  assert.equal(s.withPlan, 0);
  assert.equal(s.depositedLast30, 0);
});

test("plans and deposits count people, not rows", () => {
  const s = computeActiveStats(input({
    users: [{ id: "a", createdAt: daysAgo(50) }, { id: "b", createdAt: daysAgo(50) }],
    planOwners: ["a", "a", "b"],
    deposits: [{ userId: "a", at: daysAgo(3) }, { userId: "a", at: daysAgo(4) }, { userId: "b", at: daysAgo(31) }],
  }), now);
  assert.equal(s.withPlan, 2);
  assert.equal(s.depositedLast30, 1);
});

test("households of two and retention by signup week", () => {
  const s = computeActiveStats(input({
    users: [
      { id: "a", createdAt: new Date("2026-10-27T10:00:00Z") },
      { id: "b", createdAt: new Date("2026-10-29T10:00:00Z") },
      { id: "c", createdAt: new Date("2026-11-03T10:00:00Z") },
    ],
    activity: [{ userId: "a", at: daysAgo(1) }, { userId: "c", at: daysAgo(1) }],
    householdSizes: [2, 1, 2],
  }), now);
  assert.equal(s.householdsOfTwo, 2);
  assert.deepEqual(s.cohorts, [
    { weekStart: "2026-10-26", registered: 2, active30: 1 },
    { weekStart: "2026-11-02", registered: 1, active30: 1 },
  ]);
});

test("the report has numbers and dates only", () => {
  const s = computeActiveStats(input({
    users: [{ id: "user-secret-id", createdAt: daysAgo(2) }],
    activity: [{ userId: "user-secret-id", at: daysAgo(1) }],
  }), now);
  const text = formatActiveStats(s, now);
  assert.ok(!text.includes("user-secret-id"));
  assert.match(text, /Activos: +1 en 7 días · 1 en 30 días \(100 %\)/);
  assert.match(text, /semana del 2026-11-02: 1\/1 \(100 %\)/);
});

test("an empty database reports zeros without dividing by zero", () => {
  const text = formatActiveStats(computeActiveStats(input(), now), now);
  assert.match(text, /Registrados: +0 en total/);
  assert.match(text, /nadie registrado todavía/);
  assert.ok(!text.includes("NaN"));
});
