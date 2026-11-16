import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeaceStats, formatPeaceStats, isMissingTable, isPeaceScore, peopleBand, type PeaceRow } from "./peace.js";

const now = new Date("2026-11-13T12:00:00Z"); // closed months: 2026-10, 2026-09, 2026-08
const at = (iso: string) => new Date(iso);
const row = (userId: string, score: number, when = "2026-10-15T10:00:00Z"): PeaceRow => ({ userId, score, createdAt: at(when) });
/** n people answering `score` in a month. */
const people = (prefix: string, n: number, score: number, when?: string) =>
  Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, score, when));

test("a score is an integer from 1 to 5", () => {
  for (const ok of [1, 2, 3, 4, 5]) assert.ok(isPeaceScore(ok));
  for (const bad of [0, 6, 2.5, "3", null, undefined, NaN, -1]) assert.ok(!isPeaceScore(bad), String(bad));
});

test("people are shown as bands, never exactly, and not at all under 5", () => {
  assert.equal(peopleBand(4), null);
  assert.equal(peopleBand(5), "5–9");
  assert.equal(peopleBand(9), "5–9");
  assert.equal(peopleBand(10), "10–19");
  assert.equal(peopleBand(19), "10–19");
  assert.equal(peopleBand(20), "20–49");
  assert.equal(peopleBand(49), "20–49");
  assert.equal(peopleBand(50), "50+");
});

test("only closed calendar months: this month's answers are never counted", () => {
  const rows = [...people("oct", 4, 3), ...people("now", 6, 5, "2026-11-02T09:00:00Z")];
  const s = computePeaceStats(rows, now);
  assert.deepEqual(s.months.map(m => m.month), ["2026-10", "2026-09", "2026-08"]);
  assert.equal(s.months[0].summary, null, "4 in October; November's 6 don't help");
  assert.match(formatPeaceStats(s), /2026-10: menos de 5/);
  assert.doesNotMatch(formatPeaceStats(s), /2026-11/);
  // The month boundary is UTC midnight of the 1st.
  const edge = computePeaceStats([...people("e", 5, 2, "2026-10-31T23:59:59Z")], now);
  assert.equal(edge.months[0].summary?.average, 2);
  assert.equal(computePeaceStats(people("e", 5, 2, "2026-11-01T00:00:00Z"), now).months[0].summary, null);
});

test("5 or more people in a month: average to one decimal and a band; each person once (their latest that month)", () => {
  const rows = [row("a", 1), row("b", 2), row("c", 4), row("d", 4), row("e", 1, "2026-10-01T08:00:00Z"), row("e", 5, "2026-10-20T08:00:00Z")];
  const m = computePeaceStats(rows, now).months[0];
  assert.equal(m.summary?.average, 3.2);
  assert.equal(m.summary?.people, "5–9");
  assert.match(formatPeaceStats(computePeaceStats(rows, now)), /2026-10: media 3,2 · 5–9 personas/);
});

test("the distribution is shown only when every chosen face has 5 or more people", () => {
  const unsafe = [...people("a", 5, 4), ...people("b", 1, 1)];
  const s1 = computePeaceStats(unsafe, now);
  assert.equal(s1.months[0].summary?.distribution, null, "one person on face 1 would be exposed");
  assert.doesNotMatch(formatPeaceStats(s1), /distribución/);

  const safe = [...people("a", 5, 4), ...people("b", 6, 2)];
  const s2 = computePeaceStats(safe, now);
  assert.deepEqual(s2.months[0].summary?.distribution, [0, 6, 0, 5, 0]);
  assert.equal(s2.months[0].summary?.people, "10–19");
});

test("trend: first vs latest by when given, only when up, same and down each have 5 or more", () => {
  const two = (prefix: string, n: number, first: number, last: number) => Array.from({ length: n }, (_, i) => [
    row(`${prefix}${i}`, first, "2026-08-10T00:00:00Z"), row(`${prefix}${i}`, last, "2026-10-10T00:00:00Z"),
  ]).flat();
  const enough = [...two("u", 5, 2, 4), ...two("s", 5, 3, 3), ...two("d", 5, 4, 2)];
  assert.deepEqual(computePeaceStats(enough, now).trend, { people: "10–19", up: 5, same: 5, down: 5 });

  const fewDown = [...two("u", 9, 2, 4), ...two("s", 9, 3, 3), ...two("d", 4, 4, 2)];
  const s = computePeaceStats(fewDown, now);
  assert.equal(s.trend, null, "4 people going down would be exposed");
  assert.match(formatPeaceStats(s), /sin datos suficientes/);

  // An answer from this month doesn't count either.
  const later = [...two("u", 5, 2, 4), ...two("s", 5, 3, 3), ...two("d", 4, 4, 2), row("d9", 4, "2026-09-01T00:00:00Z"), row("d9", 2, "2026-11-05T00:00:00Z")];
  assert.equal(computePeaceStats(later, now).trend, null);
});

test("a payday change can make a later answer's period label earlier: order is by when it was given", () => {
  // The person answered 5 in October, then (after changing payday) 1 in
  // September's label but given later — rows carry no label here at all:
  // only createdAt decides first and latest.
  const rows = Array.from({ length: 5 }, (_, i) => [
    row(`p${i}`, 5, "2026-09-05T00:00:00Z"), row(`p${i}`, 1, "2026-10-05T00:00:00Z"),
  ]).flat();
  const s = computePeaceStats(rows, now);
  assert.equal(s.months[0].summary?.average, 1, "October: the answer given in October");
  assert.equal(s.months[1].summary?.average, 5);
});

test("the report never prints an id, an exact head count or a single answer", () => {
  const rows = [...people("user-", 7, 3), ...people("x-", 1, 5)];
  const text = formatPeaceStats(computePeaceStats(rows, now));
  assert.doesNotMatch(text, /user-|x-|\b8\b|\b7\b/);
  assert.match(text, /5–9 personas/);
});

test("a missing table is recognised and reported, not thrown", () => {
  assert.ok(isMissingTable({ code: "P2021" }));
  assert.ok(isMissingTable({ code: "42P01" }));
  assert.ok(!isMissingTable({ code: "P2002" }));
  assert.ok(!isMissingTable(null));
  assert.match(formatPeaceStats(null), /no existe todavía/);
});
