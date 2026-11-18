// Run with:  node --import tsx --test server/lib/hormiga.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hormigaTotals, isSubscription, debtPaymentMerchants, monthlyCents, nameWords, notSubscriptionLine,
  smallFrequentFrom, subscriptionItem, yearlyCents, type ChargeInfo, type LineInfo,
} from "./hormiga.js";
import type { RecurringCandidate } from "./recurring.js";

const line = (id: string, name: string, type = "fixed", debtId: string | null = null): LineInfo => ({ id, name, icon: "•", type, debtId });
const LINES = new Map([
  line("fijos", "Gastos fijos"),
  line("casa", "Alquiler o hipoteca"),
  line("suministros", "Luz, agua y gas"),
  line("seguros", "Seguros"),
  line("subs", "Suscripciones"),
  line("ocio", "Ocio", "flexible"),
  line("cafe", "Cafés", "flexible"),
  line("prestamo", "Préstamo coche", "debt", "debt1"),
  line("plan", "Fondo de emergencia", "plan"),
  line("dar", "Generosidad", "generosity"),
].map(l => [l.id, l]));

const candidate = (merchant: string, allocationId: string | null, extra: Partial<RecurringCandidate> = {}): RecurringCandidate => ({
  merchant, avgAmount: 1299, cadence: "monthly", nextExpectedDate: new Date(2026, 11, 5), allocationId,
  lastAmount: 1299, lastDate: new Date(2026, 10, 5), previousAmount: null, isNew: false, ...extra,
});
const charge = (merchant: string, amount: number, allocationId: string | null = null, debtId: string | null = null, d = 5): ChargeInfo =>
  ({ merchant, amount, date: new Date(2026, 10, d), allocationId, debtId });

test("nameWords drops accents and case and splits on anything else", () => {
  assert.deepEqual(nameWords("Luz, agua y Gas"), ["luz", "agua", "y", "gas"]);
  assert.deepEqual(nameWords("Préstamo  coche"), ["prestamo", "coche"]);
});

test("any recurring charge is a subscription, whatever its amount, in an ordinary category", () => {
  const none = new Set<string>();
  assert.ok(isSubscription(candidate("netflix", "subs"), none, LINES));
  assert.ok(isSubscription(candidate("gimnasio", "fijos", { avgAmount: 4500 }), none, LINES), "Gastos fijos is not 'gas'");
  assert.ok(isSubscription(candidate("spotify", null), none, LINES), "no category");
  assert.ok(isSubscription(candidate("movistar", "ocio"), none, LINES));
});

test("not a subscription: housing, utilities, insurance, debt, plan and generosity lines", () => {
  const none = new Set<string>();
  for (const id of ["casa", "suministros", "seguros", "prestamo", "plan", "dar"]) {
    assert.ok(!isSubscription(candidate("x", id), none, LINES), id);
  }
  assert.ok(notSubscriptionLine(line("l", "Rent")));
  assert.ok(notSubscriptionLine(line("l", "Home insurance")));
  assert.ok(!notSubscriptionLine(line("l", "Gasolina")), "a word, not a prefix");
});

test("not a subscription: a merchant whose charges pay a debt (loan or card payment)", () => {
  const history = [charge("cofidis", 15000, "fijos", "debt1"), charge("netflix", 1299, "subs")];
  const debts = debtPaymentMerchants(history);
  assert.ok(!isSubscription(candidate("cofidis", "fijos"), debts, LINES));
  assert.ok(isSubscription(candidate("netflix", "subs"), debts, LINES));
});

test("monthly and yearly figures per cadence", () => {
  assert.equal(yearlyCents(1299, "monthly"), 15588);
  assert.equal(yearlyCents(900, "weekly"), 46800);
  assert.equal(yearlyCents(4990, "yearly"), 4990);
  assert.equal(monthlyCents(4990, "yearly"), 416);
  assert.equal(monthlyCents(900, "weekly"), 3900);
});

test("a subscription's price is the new one after a rise, else the average", () => {
  assert.equal(subscriptionItem(candidate("netflix", "subs", { avgAmount: 1374, lastAmount: 1599, previousAmount: 1299 })).amount, 1599);
  assert.equal(subscriptionItem(candidate("netflix", "subs", { avgAmount: 1299, lastAmount: 1350 })).amount, 1299);
});

test("small frequent: under 10 €, 4 or more times in the month at one merchant — 'Café: 3,20 € × 18'", () => {
  const month = Array.from({ length: 18 }, (_, i) => charge("cafe lopez", 320, "cafe", null, i + 1));
  const [cafe] = smallFrequentFrom(month, LINES);
  assert.equal(cafe.kind, "merchant");
  assert.equal(cafe.count, 18);
  assert.equal(cafe.amount, 320);
  assert.equal(cafe.total, 5760);
  assert.equal(cafe.yearlyTotal, 69120);
});

test("small frequent: 3 times is not enough, and 10 € or more is not small", () => {
  assert.deepEqual(smallFrequentFrom([1, 2, 3].map(d => charge("kiosko", 250, null, null, d)), LINES), []);
  assert.deepEqual(smallFrequentFrom([1, 2, 3, 4].map(d => charge("bar", 1000, null, null, d)), LINES), []);
});

test("small frequent by category: different shops, the same line, 4 or more times", () => {
  const month = [charge("panaderia a", 180, "ocio"), charge("kiosko b", 250, "ocio"), charge("bar c", 300, "ocio"), charge("helados d", 400, "ocio")];
  const [item] = smallFrequentFrom(month, LINES);
  assert.equal(item.kind, "category");
  assert.equal(item.key, "ocio");
  assert.equal(item.label, "Ocio");
  assert.equal(item.total, 1130);
});

test("small frequent leaves out subscriptions, debt payments and savings/generosity lines", () => {
  const weekly = [1, 8, 15, 22].map(d => charge("app", 299, "subs", null, d));
  assert.deepEqual(smallFrequentFrom(weekly, LINES, new Set(["app"])), [], "a subscription is never counted twice");
  assert.deepEqual(smallFrequentFrom([1, 2, 3, 4].map(d => charge("bizum", 500, "plan", null, d)), LINES), []);
  assert.deepEqual(smallFrequentFrom([1, 2, 3, 4].map(d => charge("visa", 500, null, "debt1", d)), LINES), []);
});

test("totals: subscriptions a year, small × 12, and half of it all", () => {
  const subs = [subscriptionItem(candidate("netflix", "subs"))];
  const small = smallFrequentFrom(Array.from({ length: 18 }, (_, i) => charge("cafe", 320, null, null, i + 1)), LINES);
  const t = hormigaTotals(subs, small);
  assert.equal(t.subscriptionsYearly, 15588);
  assert.equal(t.subscriptionsMonthly, 1299);
  assert.equal(t.smallTotal, 5760);
  assert.equal(t.smallYearly, 69120);
  assert.equal(t.yearlyTotal, 84708);
  assert.equal(t.monthlyTotal, 7059);
  assert.equal(t.halfYearly, 42354);
});
