// Run with:  node --import tsx --test server/lib/debtAccountLink.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { debtAccountLinkError, cardDebtKindLocked, ownerChangeSplitsDebtLink, creditCardOnNonCardAccount, mirroredCardDebtId } from "./debtAccountLink.js";

const HER = "her";
const EX = "ex";
const herCard = { type: "card", ownerUserId: HER };

test("a card account that already backs a debt refuses a second one", () => {
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "installment" }, herCard, [{ id: "card-debt" }]), "card_already_has_debt");
  assert.equal(debtAccountLinkError({ id: "other-debt", ownerUserId: HER, kind: "installment" }, herCard, [{ id: "card-debt" }]), "card_already_has_debt");
});

test("a card account with no debt, or its own debt re-linked, is fine", () => {
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "installment" }, herCard, []), null);
  assert.equal(debtAccountLinkError({ id: "card-debt", ownerUserId: HER, kind: "credit_card" }, herCard, [{ id: "card-debt" }]), null);
});

test("a non-card account isn't limited to one debt", () => {
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "installment" }, { type: "checking", ownerUserId: HER }, [{ id: "loan" }]), null);
});

test("a debt is only linked to an account of its own owner, whatever its kind", () => {
  // Her loan on the ex's checking account, her card debt on the ex's card:
  // the ex's purchases would feed her balance.
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "installment" }, { type: "checking", ownerUserId: EX }, []), "debt_account_owner_mismatch");
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "installment" }, { type: "card", ownerUserId: EX }, []), "debt_account_owner_mismatch");
  assert.equal(debtAccountLinkError({ id: "loan", ownerUserId: EX, kind: "installment" }, { type: "checking", ownerUserId: HER }, []), "debt_account_owner_mismatch");
});

test("an account can't change owner while it backs a debt of another owner", () => {
  const debts = [{ id: "card-debt", ownerUserId: HER }, { id: "loan", ownerUserId: HER }];
  // The card's own debt follows its card; the loan would be left behind.
  assert.equal(ownerChangeSplitsDebtLink(EX, debts, "card-debt"), true);
  assert.equal(ownerChangeSplitsDebtLink(EX, [debts[0]], "card-debt"), false);
  assert.equal(ownerChangeSplitsDebtLink(HER, debts, null), false);
  assert.equal(ownerChangeSplitsDebtLink(EX, [], null), false);
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

test("a credit_card debt only links to a card account", () => {
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "credit_card" }, { type: "checking", ownerUserId: HER }, []), "credit_card_needs_card_account");
  assert.equal(debtAccountLinkError({ id: "loan", ownerUserId: HER, kind: "credit_card" }, { type: "savings", ownerUserId: HER }, [{ id: "loan" }]), "credit_card_needs_card_account");
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "credit_card" }, herCard, []), null);
  // Owner mismatch is reported first, as before.
  assert.equal(debtAccountLinkError({ ownerUserId: HER, kind: "credit_card" }, { type: "checking", ownerUserId: EX }, []), "debt_account_owner_mismatch");
  assert.equal(creditCardOnNonCardAccount("credit_card", "checking"), true);
  assert.equal(creditCardOnNonCardAccount("credit_card", "card"), false);
  assert.equal(creditCardOnNonCardAccount("installment", "checking"), false);
});

test("only a card account has a debt that follows it to a new owner", () => {
  assert.equal(mirroredCardDebtId("card", "card-debt"), "card-debt");
  assert.equal(mirroredCardDebtId("card", null), null);
  // A credit_card debt on a checking account is not the account's own debt:
  // handing the account over would leave it with another owner.
  assert.equal(mirroredCardDebtId("checking", "legacy-card-debt"), null);
  const debts = [{ id: "legacy-card-debt", ownerUserId: HER }];
  assert.equal(ownerChangeSplitsDebtLink(EX, debts, mirroredCardDebtId("checking", "legacy-card-debt")), true);
});
