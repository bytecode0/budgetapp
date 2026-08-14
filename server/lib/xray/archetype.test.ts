import { test } from "node:test";
import assert from "node:assert/strict";
import { computeArchetype, archetypeLight, type ArchetypeInput } from "./archetype.js";

const base: ArchetypeInput = {
  monthsCovered: 12,
  incomeCents: 2_000_00 * 12,       // €2000/month
  givingMonths: 0,
  givingAmounts: [],
  savingsCents: 0,
  investmentCents: 0,
  debtPctOfIncome: 0,
};
// €100/month for 11 of 12 months = 5% of a €2000 income — the user's own example.
const faithful = { givingMonths: 11, givingAmounts: Array(11).fill(100_00) };

test("archetype: gives faithfully but saves nothing → El Dador Valiente", () => {
  const r = computeArchetype({ ...base, ...faithful });
  assert.equal(r.key, "braveGiver");
  assert.equal(r.faithfulGiver, true);
});

test("archetype: gives faithfully and saves → El Mayordomo Fiel", () => {
  const r = computeArchetype({ ...base, ...faithful, savingsCents: 300_00 * 12 });
  assert.equal(r.key, "steward");
});

test("archetype: gives faithfully and invests → El Mayordomo que Multiplica", () => {
  const r = computeArchetype({ ...base, ...faithful, investmentCents: 300_00 * 12 });
  assert.equal(r.key, "multiplier");
});

test("archetype: invests without giving → El Sembrador", () => {
  const r = computeArchetype({ ...base, investmentCents: 400_00 * 12 });
  assert.equal(r.key, "sower");
  assert.equal(r.faithfulGiver, false);
});

test("archetype: saves only → El Constructor Silencioso", () => {
  const r = computeArchetype({ ...base, savingsCents: 400_00 * 12 });
  assert.equal(r.key, "builder");
});

test("archetype: no margin and debt-burdened → El Esclavo del Mes", () => {
  assert.equal(computeArchetype({ ...base, debtPctOfIncome: 0.34 }).key, "slave");
});

test("archetype: no margin but no debt burden → El Malabarista", () => {
  assert.equal(computeArchetype({ ...base, debtPctOfIncome: 0.05 }).key, "juggler");
});

test("archetype: a high score is NOT enough to be called a steward", () => {
  // The original bug: someone saving hard but not giving was awarded Mayordomo.
  const r = computeArchetype({ ...base, savingsCents: 1_200_00 * 12, investmentCents: 0 });
  assert.notEqual(r.key, "steward");
  assert.equal(r.key, "builder");
});

test("archetype: giving below 5% of income is not faithful giving", () => {
  const r = computeArchetype({
    ...base, givingMonths: 12, givingAmounts: Array(12).fill(40_00), savingsCents: 300_00 * 12,
  });
  assert.equal(r.faithfulGiver, false, "2% of income doesn't qualify");
  assert.equal(r.key, "builder");
});

test("archetype: giving only occasionally is not faithful giving", () => {
  const r = computeArchetype({
    ...base, givingMonths: 5, givingAmounts: Array(5).fill(200_00), savingsCents: 300_00 * 12,
  });
  assert.equal(r.faithfulGiver, false, "5 of 12 months is not a habit");
});

test("archetype: amounts must be stable, but need not be identical", () => {
  // The user's real case: €150 and €200 tithes. Stable enough (CV ≈ 0.14).
  const varied = [150_00, 200_00, 150_00, 200_00, 150_00, 150_00, 200_00, 150_00, 200_00, 150_00, 150_00];
  const ok = computeArchetype({ ...base, givingMonths: 11, givingAmounts: varied, savingsCents: 300_00 * 12 });
  assert.equal(ok.faithfulGiver, true, "150/200 alternating still counts as faithful");

  // Wildly erratic amounts are not a committed arrangement.
  const erratic = [10_00, 500_00, 20_00, 700_00, 15_00, 900_00, 30_00, 400_00, 12_00, 800_00, 25_00];
  const no = computeArchetype({ ...base, givingMonths: 11, givingAmounts: erratic, savingsCents: 300_00 * 12 });
  assert.equal(no.faithfulGiver, false, "erratic amounts are not faithful giving");
});

test("archetype: under 3 months the giving axis is not assessed at all", () => {
  const r = computeArchetype({
    ...base, monthsCovered: 2, incomeCents: 2_000_00 * 2,
    givingMonths: 2, givingAmounts: [200_00, 200_00], savingsCents: 300_00 * 2,
  });
  assert.equal(r.givingAssessed, false);
  assert.equal(r.faithfulGiver, false, "can't call it a habit from 2 months");
  assert.equal(r.key, "builder", "falls back to the margin axis only");
});

test("archetype: traffic light flags the fragile ones", () => {
  assert.equal(archetypeLight("slave"), "red");
  assert.equal(archetypeLight("juggler"), "amber");
  assert.equal(archetypeLight("braveGiver"), "amber", "faithful but no cushion is still fragile");
  assert.equal(archetypeLight("steward"), "green");
  assert.equal(archetypeLight("multiplier"), "green");
});
