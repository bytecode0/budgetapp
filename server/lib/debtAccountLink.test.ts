// Run with:  node --import tsx --test server/lib/debtAccountLink.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { debtAccountLinkError, cardDebtKindLocked } from "./debtAccountLink.js";

test("a card account that already backs a debt refuses a second one", () => {
  assert.equal(debtAccountLinkError(undefined, { type: "card" }, [{ id: "card-debt" }]), "card_already_has_debt");
  assert.equal(debtAccountLinkError("other-debt", { type: "card" }, [{ id: "card-debt" }]), "card_already_has_debt");
});

test("a card account with no debt, or its own debt re-linked, is fine", () => {
  assert.equal(debtAccountLinkError(undefined, { type: "card" }, []), null);
  assert.equal(debtAccountLinkError("card-debt", { type: "card" }, [{ id: "card-debt" }]), null);
});

test("a non-card account isn't limited to one debt", () => {
  assert.equal(debtAccountLinkError(undefined, { type: "checking" }, [{ id: "loan" }]), null);
});

test("a card's own debt can't change kind while on its card", () => {
  const cardDebt = { kind: "credit_card", accountId: "card" };
  assert.equal(cardDebtKindLocked(cardDebt, "card", "installment"), true);
  assert.equal(cardDebtKindLocked(cardDebt, "card", "credit_card"), false);
  assert.equal(cardDebtKindLocked(cardDebt, "card", undefined), false);
  // Not on a card account (legacy link to a checking account, or none): free.
  assert.equal(cardDebtKindLocked(cardDebt, "checking", "installment"), false);
  assert.equal(cardDebtKindLocked({ kind: "credit_card", accountId: null }, null, "installment"), false);
  assert.equal(cardDebtKindLocked({ kind: "installment", accountId: "card" }, "card", "bnpl"), false);
});
