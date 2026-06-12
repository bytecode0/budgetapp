// Run with:  npx tsx --test server/lib/categorize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleMatches, pickAllocationId, RuleLike } from "./categorize.js";

const r = (matchType: string, pattern: string, allocationId: string): RuleLike => ({
  matchType,
  pattern,
  allocationId,
});

test("contains matches normalized merchant substring, case/accent-insensitive", () => {
  assert.equal(ruleMatches(r("contains", "MERCADONA", "a1"), "Mercadona SA 1234", "mercadona"), true);
  assert.equal(ruleMatches(r("contains", "merca", "a1"), "x", "mercadona supermercado"), true);
  assert.equal(ruleMatches(r("contains", "lidl", "a1"), "x", "mercadona"), false);
});

test("equals matches the whole normalized merchant only", () => {
  assert.equal(ruleMatches(r("equals", "Mercadona", "a1"), "x", "mercadona"), true);
  assert.equal(ruleMatches(r("equals", "merca", "a1"), "x", "mercadona"), false);
});

test("regex matches against the raw description, case-insensitive", () => {
  assert.equal(ruleMatches(r("regex", "^netflix", "a1"), "NETFLIX.COM", "netflix com"), true);
  assert.equal(ruleMatches(r("regex", "spotify|netflix", "a1"), "Spotify AB", "spotify"), true);
  assert.equal(ruleMatches(r("regex", "^zzz", "a1"), "Netflix", "netflix"), false);
});

test("invalid regex never matches (and does not throw)", () => {
  assert.equal(ruleMatches(r("regex", "([unclosed", "a1"), "anything", "anything"), false);
});

test("empty pattern / empty merchant do not match", () => {
  assert.equal(ruleMatches(r("contains", "", "a1"), "x", "mercadona"), false);
  assert.equal(ruleMatches(r("equals", "mercadona", "a1"), "x", ""), false);
});

test("pickAllocationId returns first match in precedence order", () => {
  // Caller pre-sorts by priority desc; first match wins.
  const rules = [
    r("contains", "mercadona", "FOOD"), // higher priority, listed first
    r("contains", "merca", "GENERIC"),
  ];
  assert.equal(pickAllocationId(rules, "Mercadona", "mercadona"), "FOOD");
});

test("pickAllocationId returns null when nothing matches", () => {
  const rules = [r("contains", "lidl", "FOOD")];
  assert.equal(pickAllocationId(rules, "Mercadona", "mercadona"), null);
});
