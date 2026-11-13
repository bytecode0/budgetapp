import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeaceStats, formatPeaceStats, isPeaceScore, MIN_GROUP, type PeaceRow } from "./peace.js";

const now = new Date("2026-11-13T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const row = (userId: string, period: string, score: number, ago = 2): PeaceRow => ({ userId, period, score, createdAt: daysAgo(ago) });

test("a score is an integer from 1 to 5", () => {
  for (const ok of [1, 2, 3, 4, 5]) assert.ok(isPeaceScore(ok));
  for (const bad of [0, 6, 2.5, "3", null, undefined, NaN, -1]) assert.ok(!isPeaceScore(bad), String(bad));
});

test("fewer than 5 answers: nothing is shown, not even the count", () => {
  const rows = ["a", "b", "c", "d"].map((u, i) => row(u, "2026-11", i + 1));
  const s = computePeaceStats(rows, now);
  assert.equal(s.recent, null);
  assert.equal(s.trend, null);
  const text = formatPeaceStats(s);
  assert.match(text, /menos de 5/);
  assert.doesNotMatch(text, /media|4 respondieron/);
});

test("5 answers: average, how many, distribution 1–5", () => {
  const rows = [row("a", "2026-11", 1), row("b", "2026-11", 2), row("c", "2026-11", 4), row("d", "2026-11", 4), row("e", "2026-11", 5)];
  const s = computePeaceStats(rows, now);
  assert.deepEqual(s.recent, { answered: 5, average: 3.2, distribution: [1, 1, 0, 2, 1] });
  assert.match(formatPeaceStats(s), /5 respondieron · media 3,2 · distribución 1–5: 1 \/ 1 \/ 0 \/ 2 \/ 1/);
});

test("the last period is each person's latest answer from the last 31 days", () => {
  const rows = [
    ...["a", "b", "c", "d"].map(u => row(u, "2026-11", 3)),
    row("e", "2026-11", 3, 2),
    row("e", "2026-10", 1, 33), // e's older answer: not counted twice
    row("f", "2026-09", 5, 60), // too old: f has not answered lately
  ];
  const s = computePeaceStats(rows, now);
  assert.equal(s.recent?.answered, 5);
  assert.equal(s.recent?.average, 3);
});

test("trend: first answer vs latest, only for people with 2+ answers, only 5 or more of them", () => {
  const two = (u: string, first: number, last: number) => [row(u, "2026-09", first, 60), row(u, "2026-11", last)];
  const four = [...two("a", 2, 4), ...two("b", 3, 3), ...two("c", 4, 2), ...two("d", 1, 2), row("solo", "2026-11", 5)];
  assert.equal(computePeaceStats(four, now).trend, null, "4 people with 2+ answers is under the threshold");

  const five = [...four, row("e", "2026-08", 5, 90), row("e", "2026-10", 1, 30), row("e", "2026-11", 5)];
  assert.deepEqual(computePeaceStats(five, now).trend, { people: 5, up: 2, same: 2, down: 1 });
});

test("the report never prints an id, a period or a single answer", () => {
  const rows = Array.from({ length: MIN_GROUP }, (_, i) => [row(`user-${i}`, "2026-10", 2, 30), row(`user-${i}`, "2026-11", 4)]).flat();
  const text = formatPeaceStats(computePeaceStats(rows, now));
  assert.doesNotMatch(text, /user-|2026-/);
});
