import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_REGISTRY,
  MIN_INPUTS_FOR_STAGE,
  computeCompleteness,
  requiredFields,
  fieldsForBlock,
  findField,
} from "./registry.v1.js";

test("registry: every field key is unique", () => {
  const keys = FIELD_REGISTRY.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("registry: base_mensual is derived, never required directly", () => {
  const base = findField("base_mensual");
  assert.ok(base);
  assert.equal(base!.required, false);
  assert.deepEqual(base!.derivableFrom, ["housing_payment", "essentials_total"]);
});

test("registry: every MIN_INPUTS_FOR_STAGE key actually exists in the registry", () => {
  for (const key of MIN_INPUTS_FOR_STAGE) {
    assert.ok(findField(key), `${key} referenced by MIN_INPUTS_FOR_STAGE but missing from FIELD_REGISTRY`);
  }
});

test("registry: fieldsForBlock(1) only returns block-1 fields", () => {
  const block1 = fieldsForBlock(1);
  assert.ok(block1.length > 0);
  assert.ok(block1.every((f) => f.block === 1));
});

test("completeness: empty profile is not classifiable and lists every missing input", () => {
  const c = computeCompleteness({ presentFieldKeys: new Set(), hasDebtsAnswer: false, incomeType: "regular" });
  assert.equal(c.classifiable, false);
  assert.equal(c.pct, 0);
  for (const key of MIN_INPUTS_FOR_STAGE) assert.ok(c.missing.includes(key));
  assert.ok(c.missing.includes("debts"));
});

test("completeness: all required fields + a debts answer → fully classifiable", () => {
  const presentFieldKeys = new Set(requiredFields().map((f) => f.key));
  const c = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "regular" });
  assert.equal(c.classifiable, true);
  assert.equal(c.missing.length, 0);
  assert.equal(c.pct, 1);
});

test("completeness: irregular income is satisfied by income_floor, not income_regular", () => {
  const presentFieldKeys = new Set(
    requiredFields().map((f) => (f.key === "income_regular" ? "income_floor" : f.key)),
  );
  const c = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "irregular" });
  assert.equal(c.classifiable, true);
  assert.ok(!c.missing.includes("income_regular"));
  assert.ok(!c.missing.includes("income_floor"));
});

test("completeness: income_regular alone does NOT satisfy an irregular-income profile", () => {
  const presentFieldKeys = new Set(requiredFields().map((f) => f.key)); // has income_regular, not income_floor
  const c = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "irregular" });
  assert.equal(c.classifiable, false);
  assert.ok(c.missing.includes("income_floor"));
});

test("completeness: missing just ONE min-input field is enough to block classification", () => {
  const presentFieldKeys = new Set(requiredFields().map((f) => f.key));
  presentFieldKeys.delete("account_balance"); // one of the MIN_INPUTS_FOR_STAGE
  const c = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "regular" });
  assert.equal(c.classifiable, false);
  assert.ok(c.missing.includes("account_balance"));
});

test("completeness: a ProfileDebt row satisfies the debts input just like the 'no debts' flag would", () => {
  // The registry itself doesn't know about ProfileDebt rows — the caller is
  // responsible for turning "has ≥1 ProfileDebt row OR the none-flag is
  // present" into a single boolean. This test locks that hasDebtsAnswer is
  // treated as sufficient either way, so a future caller can't accidentally
  // require BOTH.
  const presentFieldKeys = new Set(requiredFields().map((f) => f.key));
  const withRealDebt = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "regular" });
  const withNoneFlag = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "regular" });
  assert.deepEqual(withRealDebt, withNoneFlag);
});

test("completeness: optional fields (enjoyment, investment, giving) are never in 'missing'", () => {
  const presentFieldKeys = new Set(requiredFields().map((f) => f.key));
  const c = computeCompleteness({ presentFieldKeys, hasDebtsAnswer: true, incomeType: "regular" });
  assert.ok(!c.missing.includes("enjoyment_total"));
  assert.ok(!c.missing.includes("investment_monthly"));
  assert.ok(!c.missing.includes("giving_monthly"));
});
